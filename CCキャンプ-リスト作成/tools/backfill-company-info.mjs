#!/usr/bin/env node
/**
 * backfill-company-info.mjs
 * 東たくみ の行で会社名・代表者名が未入力 or 汚れているものを補完する。
 * YouTube の about ページから公式サイト URL を取り出し、直接 HTTP でスクレイプ。
 * 検索 API (Brave / Google) は使わない。
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readSheetValues, saveSpreadsheetId, updateRows } from "./lib/sheets.mjs";
import { sanitizeCompanyName, sanitizeRepresentativeName } from "./lib/contact-discovery.mjs";

const SPREADSHEET_ID = "1E7sL6TjDiGWUF77uMAc88XK7OzXXS8wgDgwInI5Ad1c";
const SHEET_NAME = "スポーツ用品業界：メールアドレス";
const WRITER_NAME = "東たくみ";
const DRY_RUN = process.argv.includes("--dry-run");

const FETCH_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "accept-language": "ja,en-US;q=0.9,en;q=0.8",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const CANDIDATE_PATHS = [
  "/tokushoho",
  "/tokushoho/",
  "/tokusho",
  "/tokusho/",
  "/specified-commercial-transactions",
  "/specified-commercial-transactions/",
  "/law",
  "/law/",
  "/legal",
  "/commercial",
  "/commercial/",
  "/guide/law",
  "/shop/law",
  "/shop/law_info",
  "/shop/pages/law.aspx",
  "/pages/commercial",
  "/company",
  "/company/",
  "/company/profile",
  "/about",
  "/about/",
  "/about-us",
  "/contact",
  "/contact/",
  "/inquiry",
  "/inquiry/",
  "/",
];

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const COMPANY_PATTERNS = [
  /(?:運営会社|会社名|販売会社|商号|事業者名|販売業者|ショップ名|店舗名|店名|屋号)[^\S\n]*[:：]?\s*([^\n<]{2,60})/i,
  /((?:株式会社|合同会社|有限会社)[^\s。\n|、]{1,40})/,
];
const REPRESENTATIVE_PATTERNS = [
  /(?:代表者名?|代表取締役|運営責任者|販売責任者|責任者)[^\S\n]*[:：]?\s*([^\n<]{2,40})/i,
];

// ───── ユーティリティ ─────

function decodeHtml(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripTags(html) {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|section|article|li|ul|ol|table|tr|td|th|h[1-6]|br)>/gi, "\n")
    .replace(/<(p|div|section|article|li|ul|ol|table|tr|td|th|h[1-6]|br)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();
}

function looksLikeOfficialSite(url) {
  if (!url) return false;
  return !/youtube\.com|youtu\.be|ytimg\.com|ggpht\.com|googleusercontent\.com|gstatic\.com|google\.com|googleapis\.com|instagram\.com|x\.com|twitter\.com|facebook\.com|line\.me|ameblo|note\.com|tiktok\.com|linktr\.ee/i.test(
    url
  );
}

async function fetchHtml(url, timeoutMs = 12000) {
  try {
    const response = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url || url,
      text: response.ok ? await response.text() : "",
    };
  } catch (e) {
    return { ok: false, status: 0, finalUrl: url, text: "" };
  }
}

// ───── YouTube about ページから公式サイト URL を取得 ─────

function decodeYoutubeRedirect(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "www.youtube.com" && u.pathname === "/redirect") {
      return decodeURIComponent(u.searchParams.get("q") || "");
    }
    return url;
  } catch {
    return url;
  }
}

function findDeep(obj, key, depth = 0) {
  if (depth > 12 || !obj || typeof obj !== "object") return null;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const result = findDeep(v, key, depth + 1);
    if (result) return result;
  }
  return null;
}

function findDeepString(obj, key, depth = 0) {
  if (depth > 15 || !obj || typeof obj !== "object") return "";
  if (key in obj) {
    const val = obj[key];
    if (typeof val === "string" && val.length > 5) return val;
  }
  for (const v of Object.values(obj)) {
    const result = findDeepString(v, key, depth + 1);
    if (result) return result;
  }
  return "";
}

function extractYtInitialData(html) {
  const marker = "var ytInitialData = ";
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return null;
  const jsonStart = html.indexOf("{", markerIdx + marker.length);
  if (jsonStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = jsonStart; i < html.length; i++) {
    const ch = html[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(jsonStart, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

async function getSiteUrlFromYouTube(youtubeUrl) {
  if (!youtubeUrl) return "";

  // YouTube の about ページ URL を構築
  const base = youtubeUrl.replace(/\/(about\/?|featured\/?|videos\/?)$/, "").replace(/\/$/, "");
  const aboutUrl = `${base}/about`;

  const res = await fetchHtml(aboutUrl, 18000);
  if (!res.ok || !res.text) return "";

  // ytInitialData からブラケットカウンタで確実に JSON を取り出す
  try {
    const data = extractYtInitialData(res.text);
    if (data) {
      const metadata = findDeep(data, "channelAboutFullMetadataRenderer");

      if (metadata?.primaryLinks) {
        for (const link of metadata.primaryLinks) {
          const rawUrl = link?.navigationEndpoint?.urlEndpoint?.url || "";
          const decoded = decodeYoutubeRedirect(rawUrl);
          if (decoded && looksLikeOfficialSite(decoded)) return decoded;
        }
      }

      // secondaryLinks も確認
      const headerLinks = findDeep(data, "channelHeaderLinksRenderer");
      for (const group of [headerLinks?.primaryLinks, headerLinks?.secondaryLinks]) {
        if (!group) continue;
        for (const link of group) {
          const rawUrl = link?.navigationEndpoint?.urlEndpoint?.url || "";
          const decoded = decodeYoutubeRedirect(rawUrl);
          if (decoded && looksLikeOfficialSite(decoded)) return decoded;
        }
      }

      // description からも URL を試みる（文字列形式の値を探す）
      const desc =
        (typeof metadata?.description === "string" ? metadata.description : "") ||
        (metadata?.description?.simpleText || "") ||
        findDeepString(data, "description");
      if (desc) {
        for (const u of (desc.match(/https?:\/\/[^\s\u3000-\u9fff）)]+/g) || [])) {
          const clean = u.replace(/[)>\]'"。、]+$/, "");
          if (looksLikeOfficialSite(clean)) return clean;
        }
      }
    }
  } catch {
    // JSON parse 失敗はスキップ
  }

  // フォールバック：HTML から外部リンクを正規表現で探す
  const hrefMatches = res.text.matchAll(/href=["'](https?:\/\/[^"']+)["']/g);
  for (const m of hrefMatches) {
    const decoded = decodeYoutubeRedirect(m[1]);
    if (looksLikeOfficialSite(decoded)) return decoded;
  }

  return "";
}

// ───── 公式サイトから会社名・代表者名・メールを抽出 ─────

function isReliableCompanyName(text) {
  if (!text || text.length < 2 || text.length > 60) return false;
  if (/[?]|[「」"'<>]|があります|です|ます|ください|メールアドレス|お名前|同意する|必須/.test(text)) return false;
  if (/(株式会社|合同会社|有限会社)/i.test(text)) return true;
  if (/[\u3040-\u30ff\u3400-\u9fff]/.test(text)) return true;
  return /^[A-Z0-9&.'\- ]{5,}$/i.test(text);
}

function isReliableName(text) {
  if (!text || text.length < 3 || text.length > 30) return false;
  if (!/[\u3040-\u30ff\u3400-\u9fff]/.test(text)) return false;
  if (/所在地|資本金|会社概要|プライバシー|同意する|必須|メールアドレス|お名前|著作権|紹介|ご案内|設立|開設|代表取締役|会長|取締役|役員/.test(text)) return false;
  // 漢字2文字だけの汎用語は除外
  if (/^[一-龯]{2}$/.test(text)) return false;
  return true;
}

function stripRepTitle(val) {
  return val
    .replace(/^(代表者名?|代表取締役|取締役社長|代表社員|社長|CEO|COO)\s*/gi, "")
    .replace(/\s*(代表取締役|取締役社長|設立|開設)[：:\s].*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFromText(text) {
  let companyName = "";
  let representativeName = "";

  for (const pat of COMPANY_PATTERNS) {
    const m = text.match(pat);
    if (m) {
      const raw = (m[1] || m[0] || "").replace(/[:：]/g, "").trim();
      if (isReliableCompanyName(raw)) {
        companyName = raw;
        break;
      }
    }
  }

  for (const pat of REPRESENTATIVE_PATTERNS) {
    const m = text.match(pat);
    if (m) {
      const raw = stripRepTitle((m[1] || "").trim());
      if (isReliableName(raw)) {
        representativeName = raw;
        break;
      }
    }
  }

  return { companyName, representativeName };
}

const PLATFORM_DOMAINS = /mag2\.com|lin\.ee|linepay\.me|note\.com|ameblo\.jp|livedoor\.blog|blogger\.com|wordpress\.com|wix\.com|jimdo\.com|stores\.jp|base\.shop|minne\.com|creema\.jp|pixiv\.net|nicovideo\.jp|booth\.pm|adobe\.com|express\.adobe/i;

async function discoverFromSite(siteUrl) {
  if (!siteUrl) return { companyName: "", representativeName: "" };

  let origin;
  try {
    origin = new URL(siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`).origin;
  } catch {
    return { companyName: "", representativeName: "" };
  }

  // プラットフォームドメインは自社サイトではないので企業情報取得をスキップ
  if (PLATFORM_DOMAINS.test(origin)) {
    return { companyName: "", representativeName: "" };
  }

  let companyName = "";
  let representativeName = "";

  for (const path of CANDIDATE_PATHS) {
    const url = `${origin}${path}`;
    const res = await fetchHtml(url);
    if (!res.ok || !res.text) continue;

    const text = stripTags(res.text);
    const found = extractFromText(text);

    if (!companyName && found.companyName) companyName = found.companyName;
    if (!representativeName && found.representativeName) representativeName = found.representativeName;

    if (companyName && representativeName) break;

    // 優先リンクを homepage からたどる
    if (path === "/") {
      const links = [];
      const anchorRe = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      for (const m of res.text.matchAll(anchorRe)) {
        const href = m[1];
        const anchorText = stripTags(m[2] || "");
        if (
          /特定商取引法|特商法|会社概要|会社情報|運営会社|tokusho|law|legal|commercial|about|company/i.test(
            href + anchorText
          )
        ) {
          try {
            const resolved = new URL(href, res.finalUrl);
            if (resolved.hostname === new URL(origin).hostname) links.push(resolved.toString());
          } catch {
            // ignore
          }
        }
      }
      // ホームページのリンクをそのまま CANDIDATE_PATHS の代わりに試す
      for (const link of [...new Set(links)].slice(0, 5)) {
        const r2 = await fetchHtml(link);
        if (!r2.ok || !r2.text) continue;
        const t2 = stripTags(r2.text);
        const f2 = extractFromText(t2);
        if (!companyName && f2.companyName) companyName = f2.companyName;
        if (!representativeName && f2.representativeName) representativeName = f2.representativeName;
        if (companyName && representativeName) break;
      }
    }
  }

  return { companyName, representativeName };
}

// ───── 汚れた会社名のローカル修正 ─────

function cleanDirtyCompanyName(raw) {
  if (!raw) return raw;

  // "社名：株式会社xxx" 等のプレフィックスを除去
  let cleaned = raw
    .replace(/^(?:社名|商号|会社名|販売業者|事業者名|運営会社)\s*[:：]\s*/i, "")
    .trim();

  // "(株)" → "株式会社", "(有)" → "有限会社" に変換（省略形の保護）
  cleaned = cleaned
    .replace(/^\(株\)\s*/, "株式会社")
    .replace(/^\(有\)\s*/, "有限会社")
    .replace(/\s*\(株\)$/, "株式会社")
    .replace(/\s*\(有\)$/, "有限会社")
    .trim();

  // 全角・半角カッコ内の別表記を除去: "株式会社xxx（英語名）" → "株式会社xxx"
  // ただし括弧内が "株" "有" のみの場合はすでに変換済みなのでスキップ
  cleaned = cleaned.replace(/\s*[（(][^）)]{2,80}[）)]/g, "").trim();

  // 「お問い合わせページ」等のノイズ後置を除去
  cleaned = cleaned
    .replace(/[\s　]+(お問い合わせ|ページ|page|について)[^\n]*/i, "")
    .trim();

  return cleaned;
}

// ───── メイン ─────

function findHeaderRow(rows) {
  return rows.findIndex(
    (row) => row[0] === "No" && String(row[1] || "").includes("記入者の名前")
  );
}

async function main() {
  saveSpreadsheetId(SPREADSHEET_ID);
  const rows = await readSheetValues(SHEET_NAME, "A:K");
  const headerRowIndex = findHeaderRow(rows);
  if (headerRowIndex === -1) throw new Error("ヘッダー行が見つかりませんでした");

  const targets = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const writer = String(row[1] || "").trim();
    if (writer !== WRITER_NAME) continue;

    const channelName = String(row[2] || "").trim();
    const rawCompany = String(row[3] || "").trim();
    const rawRep = String(row[4] || "").trim();
    const youtubeUrl = String(row[5] || "").trim();

    if (!channelName) continue;

    // 汚れ修正
    const cleanedCompany = cleanDirtyCompanyName(rawCompany);
    // 代表者名の後置ノイズも除去
    const cleanedRep = rawRep
      .replace(/\s*(設立|開設|創業|代表取締役|取締役)[：:\s].*/g, "")
      .trim();
    const needsCompany = !cleanedCompany || cleanedCompany !== rawCompany;
    const needsRep = !cleanedRep || cleanedRep !== rawRep;

    if (!needsCompany && !needsRep) continue;

    targets.push({
      rowNumber: i + 1,
      channelName,
      rawCompany,
      cleanedCompany,
      rawRep,
      cleanedRep,
      youtubeUrl,
    });
  }

  console.log(`対象行数: ${targets.length}`);
  if (DRY_RUN) console.log("[DRY-RUN モード: 書き込みをスキップ]");

  let updated = 0;
  let unchanged = 0;

  for (const target of targets) {
    console.log(`\n--- row=${target.rowNumber} ${target.channelName} ---`);

    // Step 1: YouTube about → 公式サイト URL
    const siteUrl = await getSiteUrlFromYouTube(target.youtubeUrl);
    console.log(`  公式サイト: ${siteUrl || "(取得できず)"}`);

    // Step 2: 公式サイトをスクレイプ
    const { companyName: scraped_company, representativeName: scraped_rep } = await discoverFromSite(siteUrl);

    // Step 3: 値を決定
    const finalCompany = sanitizeCompanyName(
      target.cleanedCompany || scraped_company
    );
    const finalRep = sanitizeRepresentativeName(target.cleanedRep || scraped_rep);

    console.log(`  会社名: ${target.rawCompany || "(なし)"} → ${finalCompany || "(なし)"}`);
    console.log(`  代表者名: ${target.cleanedRep || target.rawRep || "(なし)"} → ${finalRep || "(なし)"}`);

    const companyChanged = finalCompany !== target.rawCompany;
    const repChanged = finalRep !== target.cleanedRep;

    if (!companyChanged && !repChanged) {
      console.log(`  変更なし`);
      unchanged++;
      continue;
    }

    if (!DRY_RUN) {
      await updateRows(SHEET_NAME, target.rowNumber, 3, [[finalCompany, finalRep]]);
      console.log(`  → シートに書き込み完了`);
    } else {
      console.log(`  → [DRY-RUN] 書き込みをスキップ`);
    }
    updated++;
  }

  console.log(`\n完了: 更新=${updated} 変更なし=${unchanged} 合計=${targets.length}`);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
