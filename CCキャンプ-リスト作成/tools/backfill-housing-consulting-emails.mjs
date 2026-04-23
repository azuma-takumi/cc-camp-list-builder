#!/usr/bin/env node
/**
 * 住宅コンサルティングリスト メール補完スクリプト（YouTube API不使用版）
 * Brave/Google 検索で YouTube チャンネル URL を収集し、
 * YouTube /about ページを直接スクレイプしてメールアドレスを抽出する。
 * YouTube Data API クォータを消費しない。
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  readSheetValues, saveSpreadsheetId, getSheetsClient,
  getSpreadsheetId, updateRows,
} from "./lib/sheets.mjs";
import { discoverContactInfo, sanitizeCompanyName, sanitizeRepresentativeName } from "./lib/contact-discovery.mjs";
import { searchBraveWeb } from "./lib/brave-search-api.mjs";
import { searchGoogleWeb } from "./lib/google-search-api.mjs";
import { appendDatedLog, writeStandardSummary } from "./lib/summary-writer.mjs";

const SPREADSHEET_ID = "1x4__YI76LycSL_4DHxSrMTp2QSbbi7FXTRe3ikPN1ZE";
const ORIGINAL_SPREADSHEET_ID = "1kkN9EolMpGC7u6w1RCJoK38yZTev1nUo4CYqGi_yamM";
const SHEET_NAME = "住宅コンサルティング：メールアドレス";
const WRITER_NAME = "東たくみ";
const TARGET_WRITE_COUNT = Number(process.env.TARGET_WRITE_COUNT || "20");
const QUERY_LIMIT = Number(process.env.QUERY_LIMIT || "40");
const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, "..", "logs");

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "ja,en;q=0.9",
};

const EMAIL_REGEX = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;
const PLATFORM_DOMAINS = /note\.com|lin\.ee|line\.me|ameblo\.jp|amzn\.|bit\.ly|lit\.link|linktr\.ee|forms\.gle|docs\.google\.com|soundeffect|5ch\.net|berich\.click/i;
const SAMPLE_EMAIL_PATTERN = /^(mail@sample\.com|sample@mail\.com|test@|noreply@|no-reply@|example@)/i;

// YouTube チャンネルを住宅系キーワードで Brave/Google 検索するクエリ
const BRAVE_QUERIES = [
  "住宅コンサルタント youtube チャンネル 公式",
  "家づくりアドバイザー youtube チャンネル",
  "注文住宅 失敗しない youtube チャンネル",
  "ハウスメーカー 比較 youtube チャンネル 建築士",
  "間取り診断 youtube チャンネル 公式",
  "住宅ローン 専門家 youtube チャンネル",
  "建築士 家づくり youtube チャンネル 公式",
  "マイホーム 後悔しない youtube チャンネル",
  "工務店 家づくり youtube チャンネル 公式",
  "不動産購入 コンサルタント youtube チャンネル",
  "リノベーション 専門家 youtube チャンネル",
  "土地探し 家づくり youtube チャンネル",
  "中古住宅 リノベ youtube チャンネル 公式",
  "高気密高断熱 住宅 youtube チャンネル",
  "平屋 注文住宅 youtube チャンネル 公式",
  "二世帯住宅 設計 youtube チャンネル",
  "狭小住宅 設計事務所 youtube チャンネル",
  "住宅 省エネ ZEH youtube チャンネル",
  "不動産エージェント 住宅購入 youtube チャンネル",
  "一級建築士 住宅 youtube チャンネル",
  "インスペクター 住宅診断 youtube チャンネル",
  "家づくり 費用 坪単価 youtube チャンネル",
  "マンション購入 アドバイス youtube チャンネル",
  "建売住宅 失敗 youtube チャンネル",
  "地盤調査 住宅 youtube チャンネル",
  "住宅 耐震 構造 youtube チャンネル",
  "外構 庭 エクステリア youtube チャンネル 公式",
  "収納 動線 間取り youtube チャンネル",
  "古民家 移住 リノベ youtube チャンネル",
  "地方移住 田舎暮らし 家 youtube チャンネル",
  "住宅ローン減税 補助金 youtube チャンネル",
  "太陽光発電 蓄電池 住宅 youtube チャンネル",
  "欠陥住宅 被害 相談 youtube チャンネル",
  "木造住宅 無垢材 youtube チャンネル",
  "ペット共生 住宅 youtube チャンネル",
  "子育て 間取り 住宅 youtube チャンネル",
  "老後 バリアフリー 住宅 youtube チャンネル",
  "相続 不動産 住宅 youtube チャンネル",
  "不動産 売却 査定 youtube チャンネル",
  "賃貸 持ち家 どっち youtube チャンネル",
];

// ─── YouTube /about スクレイプ ───

function extractYtInitialData(html) {
  const marker = "var ytInitialData = ";
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const start = html.indexOf("{", idx + marker.length);
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\" && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      if (--depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function findDeep(obj, key, depth = 0) {
  if (depth > 12 || !obj || typeof obj !== "object") return null;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const r = findDeep(v, key, depth + 1);
    if (r) return r;
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
    const r = findDeepString(v, key, depth + 1);
    if (r) return r;
  }
  return "";
}

function decodeYoutubeRedirect(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "www.youtube.com" && u.pathname === "/redirect") {
      return decodeURIComponent(u.searchParams.get("q") || "");
    }
    return url;
  } catch { return url; }
}

function looksLikeOfficialSite(url) {
  if (!url) return false;
  return !/youtube\.com|youtu\.be|ytimg\.com|ggpht\.com|googleusercontent\.com|gstatic\.com|google\.com|googleapis\.com|instagram\.com|x\.com|twitter\.com|facebook\.com|line\.me|ameblo|note\.com|tiktok\.com|linktr\.ee|amzn\.|bit\.ly|lit\.link|forms\.gle|docs\.google\.com/i.test(url);
}

async function fetchHtml(url, ms = 15000) {
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(ms),
    });
    return { ok: res.ok, text: res.ok ? await res.text() : "", finalUrl: res.url || url };
  } catch { return { ok: false, text: "", finalUrl: url }; }
}

async function deepScrapeYouTube(youtubeUrl) {
  const result = { email: "", siteUrl: "", channelName: "", description: "" };
  if (!youtubeUrl) return result;

  const base = youtubeUrl.replace(/\/(about\/?|featured\/?|videos\/?)$/, "").replace(/\/$/, "");
  const res = await fetchHtml(`${base}/about`, 20000);
  if (!res.ok || !res.text) return result;

  const data = extractYtInitialData(res.text);
  if (!data) return result;

  // チャンネル名取得
  result.channelName = findDeepString(data, "title") || "";

  // description テキスト取得
  const metadata = findDeep(data, "channelAboutFullMetadataRenderer");
  const desc =
    (typeof metadata?.description === "string" ? metadata.description : "") ||
    metadata?.description?.simpleText ||
    findDeepString(data, "description") ||
    "";
  result.description = desc;

  // description からメール抽出
  const emails = (desc.match(EMAIL_REGEX) || []).filter(
    (e) => !SAMPLE_EMAIL_PATTERN.test(e)
  );
  if (emails.length) result.email = emails[0];

  // 公式サイトURL抽出
  const headerLinks = findDeep(data, "channelHeaderLinksRenderer");
  for (const group of [headerLinks?.primaryLinks, headerLinks?.secondaryLinks, metadata?.primaryLinks]) {
    if (!group) continue;
    for (const link of group) {
      const decoded = decodeYoutubeRedirect(link?.navigationEndpoint?.urlEndpoint?.url || "");
      if (decoded && looksLikeOfficialSite(decoded)) {
        result.siteUrl = decoded;
        break;
      }
    }
    if (result.siteUrl) break;
  }

  if (!result.siteUrl && desc) {
    for (const u of (desc.match(/https?:\/\/[^\s\u3000-\u9fff）)]+/g) || [])) {
      const clean = u.replace(/[)>\]'"。、]+$/, "");
      if (looksLikeOfficialSite(clean)) { result.siteUrl = clean; break; }
    }
  }

  return result;
}

// Brave/Google 検索結果から YouTube チャンネル URL を抽出
function extractYoutubeChannelUrls(searchResults) {
  const urls = [];
  for (const item of searchResults) {
    const link = item.link || item.url || "";
    // /channel/UC... または /@handle 形式
    const m = link.match(/https?:\/\/(?:www\.)?youtube\.com\/(channel\/UC[A-Za-z0-9_\-]{10,}|@[A-Za-z0-9_\-.%]+)/);
    if (m) {
      const canonical = `https://www.youtube.com/${m[1]}`;
      urls.push(canonical);
    }
  }
  return [...new Set(urls)];
}

function findHeaderRow(rows) {
  return rows.findIndex((row) => row[0] === "No" && String(row[1] || "").includes("記入者の名前"));
}

function findStartRow(rows, headerRowIndex) {
  let last = headerRowIndex + 1;
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    if (String(rows[i]?.[1] || "").trim()) last = i + 1;
  }
  return last + 1;
}

const CLIP_CHANNEL_PATTERN = /切り抜き|きりぬき|切抜き/i;
const OVERSEAS_PATTERN = /^[a-zA-Z0-9\s\-_!?.,'"@#$%&*()[\]{}|/\\+=<>~`]+$/;
const CHANNEL_BLACKLIST = new Set([
  "牛コンサルチャンネル",
  "赤沼慎太郎の経営改善・資金繰り・資金調達チャンネル",
  "ふくしまおうちチャンネルでは、【住まい工房やまぎし】のヤマさんが、新築建売住宅を語ります!",
  "カズの家づくりチャンネル【快適な住まい　理想の家づくり】",
  "オモコロチャンネル",
  "ガルシーちゃんねる",
]);

function isValidChannel(name) {
  if (!name) return false;
  if (CLIP_CHANNEL_PATTERN.test(name)) return false;
  if (OVERSEAS_PATTERN.test(name)) return false;
  if (CHANNEL_BLACKLIST.has(name)) return false;
  return true;
}

function normalizeEmailSourceForSheet(value) {
  const t = String(value || "").trim();
  if (!t) return "";
  if (/youtube|概要欄/i.test(t)) return "YouTube";
  if (/tokusho|specified-commercial|tradelaw|legal-notice|terms/i.test(t)) return "その他（特商法）";
  if (/company|profile|about|outline/i.test(t)) return "その他（会社概要）";
  if (/contact|inquiry/i.test(t)) return "その他（問い合わせフォーム）";
  if (/privacy|policy/i.test(t)) return "その他（プライバシーポリシー）";
  return "その他（HP）";
}

async function main() {
  // ── 既存チャンネル名セット（重複除外）──
  saveSpreadsheetId(SPREADSHEET_ID);
  const copyRows = await readSheetValues(SHEET_NAME, "A:K");
  const copyHeaderIdx = findHeaderRow(copyRows);
  const startRow = findStartRow(copyRows, copyHeaderIdx);

  saveSpreadsheetId(ORIGINAL_SPREADSHEET_ID);
  const origRows = await readSheetValues(SHEET_NAME, "A:C");
  const origHeaderIdx = findHeaderRow(origRows);

  const existingNames = new Set([
    ...copyRows.slice(copyHeaderIdx + 1).map((r) => String(r[2] || "").trim()).filter(Boolean),
    ...(origHeaderIdx >= 0
      ? origRows.slice(origHeaderIdx + 1).map((r) => String(r[2] || "").trim()).filter(Boolean)
      : []),
  ]);

  console.log(`既存チャンネル数: ${existingNames.size}`);
  saveSpreadsheetId(SPREADSHEET_ID);

  // ── Brave/Google で YouTube チャンネル URL を収集 ──
  const seenUrls = new Set();
  const candidates = []; // { youtubeUrl }

  for (const query of BRAVE_QUERIES.slice(0, QUERY_LIMIT)) {
    if (candidates.length >= 300) break;
    let results = [];
    try {
      const brave = await searchBraveWeb(query, 10);
      results = brave.results || [];
    } catch {
      try { results = await searchGoogleWeb(query, 10); } catch { results = []; }
    }
    const urls = extractYoutubeChannelUrls(results);
    for (const url of urls) {
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        candidates.push({ youtubeUrl: url });
      }
    }
    if (candidates.length > 0 && candidates.length % 20 === 0) {
      console.log(`  候補 ${candidates.length} 件収集中...`);
    }
  }

  console.log(`YouTube URL候補: ${candidates.length}件`);

  const readyLeads = [];
  const stillUnresolved = [];
  let processed = 0;

  for (const c of candidates) {
    if (readyLeads.length >= TARGET_WRITE_COUNT) break;

    // YouTube /about スクレイプ
    const ytScrape = await deepScrapeYouTube(c.youtubeUrl);
    const channelName = ytScrape.channelName;
    processed++;

    if (!channelName) continue;
    if (existingNames.has(channelName)) continue;
    if (!isValidChannel(channelName)) continue;

    let email = ytScrape.email;
    let emailSource = email ? "YouTube" : "";
    let siteUrl = ytScrape.siteUrl;

    // 公式サイトからもメール探索
    if (!email && siteUrl && !PLATFORM_DOMAINS.test(siteUrl)) {
      try {
        const contact = await discoverContactInfo({ siteUrl });
        if (contact.email && !SAMPLE_EMAIL_PATTERN.test(contact.email)) {
          email = contact.email;
          emailSource = normalizeEmailSourceForSheet(contact.emailSource);
        }
      } catch { /* ignore */ }
    }

    if (!email) {
      stillUnresolved.push(channelName);
      continue;
    }

    // 会社名・代表者名
    let companyName = "";
    let representativeName = "";
    if (siteUrl && !PLATFORM_DOMAINS.test(siteUrl)) {
      try {
        const contact = await discoverContactInfo({ siteUrl });
        companyName = sanitizeCompanyName(contact.companyName || "");
        representativeName = sanitizeRepresentativeName(contact.representativeName || "");
      } catch { /* ignore */ }
    }

    existingNames.add(channelName); // 重複追加防止

    readyLeads.push({
      channelName,
      companyName,
      representativeName,
      youtubeUrl: c.youtubeUrl,
      email,
      emailSource: emailSource || "YouTube",
      subscriberCount: "",       // YouTube API 枯渇中のため空（後で fill-youtube-channel-metrics で補完）
      latestVideoPublishedAt: "",
    });

    console.log(`FOUND [${readyLeads.length}]: ${channelName} -> ${email}`);
  }

  // ── シート書き込み ──
  if (readyLeads.length) {
    const today = new Date().toISOString().slice(0, 10);
    const preparedRows = readyLeads.slice(0, TARGET_WRITE_COUNT).map((l) => [
      WRITER_NAME,
      l.channelName,
      l.companyName,
      l.representativeName,
      l.youtubeUrl,
      l.email,
      l.emailSource,
      l.subscriberCount,
      l.latestVideoPublishedAt,
      today,
    ]);
    await updateRows(SHEET_NAME, startRow, 1, preparedRows);

    // J・K列 CENTER+MIDDLE 書式適用
    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetId = meta.data.sheets.find((s) => s.properties.title === SHEET_NAME)?.properties.sheetId;
    if (sheetId !== undefined) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: startRow - 1,
                endRowIndex: startRow - 1 + preparedRows.length,
                startColumnIndex: 9,
                endColumnIndex: 11,
              },
              cell: { userEnteredFormat: { horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } },
              fields: "userEnteredFormat(horizontalAlignment,verticalAlignment)",
            },
          }],
        },
      });
    }
    console.log(`書き込み完了: row${startRow}〜row${startRow + preparedRows.length - 1}`);
  }

  writeStandardSummary({
    logDir: LOG_DIR,
    fileName: "housing-consulting-backfill-emails-summary.md",
    title: "住宅コンサルティング メール補完結果（APIなし版）",
    overview: [
      { label: "YouTube URL候補", value: candidates.length },
      { label: "処理済み", value: processed },
      { label: "開始行", value: startRow },
      { label: "追加目標件数", value: TARGET_WRITE_COUNT },
    ],
    metrics: [
      { label: "書き込み成功", value: readyLeads.length },
      { label: "なお未発見", value: stillUnresolved.length },
    ],
    sections: readyLeads.length ? [{
      heading: "書き込んだ候補",
      lines: readyLeads.map((l) => `- ${l.channelName} / ${l.email}`),
    }] : [],
  });

  console.log(`START_ROW=${startRow}`);
  console.log(`WRITTEN=${readyLeads.length}`);
  console.log(`STILL_UNRESOLVED=${stillUnresolved.length}`);
}

main().catch((e) => { console.error("Error:", e.message); process.exit(1); });
