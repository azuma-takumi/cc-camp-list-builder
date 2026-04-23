#!/usr/bin/env node
/**
 * 投資リスト メール補完スクリプト
 * discover-investment-leads.mjs で「メール未発見」だったチャンネルに対して
 * YouTube /about ページの description から直接メールを抽出して書き込む
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readSheetValues, saveSpreadsheetId, getSheetsClient, getSpreadsheetId, updateRows } from "./lib/sheets.mjs";
import { searchYoutubeChannels, getYoutubeChannelMetricsByUrl, getYoutubeQuotaUsageSummary, resetYoutubeQuotaUsage } from "./lib/youtube-api.mjs";
import { discoverContactInfo, sanitizeCompanyName, sanitizeRepresentativeName } from "./lib/contact-discovery.mjs";
import { appendDatedLog, writeStandardSummary } from "./lib/summary-writer.mjs";

const SPREADSHEET_ID = "1g4_kHjFYyGpkkxtCWDdq6BHTR9pCmwT3aRHzxTV8pFY";
const ORIGINAL_SPREADSHEET_ID = "16D9nFxkfONtJV-1VmJJOA21YEnPAoy90rhMSNRWgUok";
const SHEET_NAME = "投資：メールアドレス";
const WRITER_NAME = "東たくみ";
const TARGET_WRITE_COUNT = Number(process.env.TARGET_WRITE_COUNT || "30");
const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, "..", "logs");

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "ja,en;q=0.9",
};

const EMAIL_REGEX = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;
const PERSONAL_DOMAINS = /^(gmail|yahoo|yahoo\.co|hotmail|outlook|icloud|me|live|msn|googlemail|docomo|ezweb|softbank|au)\./i;
const PLATFORM_DOMAINS = /note\.com|lin\.ee|line\.me|ameblo\.jp|amzn\.|bit\.ly|lit\.link|linktr\.ee|forms\.gle|docs\.google\.com|soundeffect|5ch\.net|berich\.click/i;

const SEARCH_QUERIES = [
  "新NISA 投資 チャンネル 公式",
  "つみたてNISA 解説 チャンネル",
  "iDeCo 確定拠出年金 チャンネル",
  "インデックスファンド 積立投資 チャンネル",
  "S&P500 全世界株式 オルカン チャンネル",
  "高配当株 配当金生活 チャンネル",
  "株式投資 初心者 チャンネル",
  "デイトレード スイングトレード チャンネル",
  "銘柄分析 決算分析 チャンネル",
  "米国株 ETF 投資 チャンネル",
  "資産運用 資産形成 チャンネル",
  "お金を増やす 資産運用 チャンネル",
  "副業 不労所得 パッシブインカム チャンネル",
  "老後資金 年金 退職金 チャンネル",
  "不動産投資 家賃収入 チャンネル",
  "アパート経営 賃貸経営 チャンネル",
  "ビットコイン 仮想通貨 投資 チャンネル",
  "経済ニュース 世界経済 投資 チャンネル",
  "お金の勉強 マネーリテラシー チャンネル",
  "ファイナンシャルプランナー FP 資産相談 チャンネル",
  "家計管理 節約 固定費削減 チャンネル",
  "生命保険 医療保険 見直し チャンネル",
  "SBI証券 楽天証券 口座開設 チャンネル",
  "複利 年利 資産シミュレーション チャンネル",
  "20代 30代 資産形成 チャンネル",
  "投資 初心者 始め方 チャンネル",
  "ポートフォリオ リバランス 分散投資 チャンネル",
  "IFA 独立系 資産運用 チャンネル",
  "節税 税金対策 節約 チャンネル",
  "スタートアップ IPO エンジェル投資 チャンネル",
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

/**
 * YouTube /about ページからメールアドレスと公式サイトURLを抽出
 */
async function deepScrapeYouTube(youtubeUrl) {
  const result = { email: "", siteUrl: "", description: "" };
  if (!youtubeUrl) return result;

  const base = youtubeUrl.replace(/\/(about\/?|featured\/?|videos\/?)$/, "").replace(/\/$/, "");
  const res = await fetchHtml(`${base}/about`, 20000);
  if (!res.ok || !res.text) return result;

  const data = extractYtInitialData(res.text);
  if (!data) return result;

  // description: 新旧両方の構造に対応
  const metaRenderer = findDeep(data, "channelMetadataRenderer");
  const metadata = findDeep(data, "channelAboutFullMetadataRenderer");
  const desc =
    (typeof metaRenderer?.description === "string" ? metaRenderer.description : "") ||
    (typeof metadata?.description === "string" ? metadata.description : "") ||
    metadata?.description?.simpleText ||
    findDeepString(data, "description") ||
    "";
  result.description = desc;

  // description からメール抽出
  const emails = (desc.match(EMAIL_REGEX) || []).filter(
    (e) => !PERSONAL_DOMAINS.test(e.split("@")[1] || "")
  );
  if (emails.length) {
    result.email = emails[0];
  }

  // 公式サイトURL: 新構造（channelExternalLinkViewModel のリダイレクトURL）を先に試す
  const dataStr = JSON.stringify(data);
  const redirectRE = /"url":"(https:\/\/www\.youtube\.com\/redirect\?[^"]+)"/g;
  for (const m of dataStr.matchAll(redirectRE)) {
    const decoded = decodeYoutubeRedirect(m[1].replace(/\\u0026/g, "&"));
    if (decoded && looksLikeOfficialSite(decoded)) { result.siteUrl = decoded; break; }
  }
  // 旧構造（channelHeaderLinksRenderer）もフォールバックとして試す
  if (!result.siteUrl) {
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
  }

  // descriptionからもURL抽出（サイトが見つからない場合）
  if (!result.siteUrl && desc) {
    for (const u of (desc.match(/https?:\/\/[^\s\u3000-\u9fff）)]+/g) || [])) {
      const clean = u.replace(/[)>\]'"。、]+$/, "");
      if (looksLikeOfficialSite(clean)) { result.siteUrl = clean; break; }
    }
  }

  return result;
}

function normalizeEmailSourceForSheet(value) {
  const t = String(value || "").trim();
  if (!t) return "";
  if (/youtube|概要欄/i.test(t)) return "YouTube";
  if (/tokusho|specified-commercial|tradelaw|legal-notice|terms/i.test(t)) return "その他（特商法）";
  if (/company|profile|about|outline/i.test(t)) return "その他（会社概要）";
  if (/contact|inquiry/i.test(t)) return "その他（問い合わせフォーム）";
  return "その他（HP）";
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

function isValidInvestmentChannel(name) {
  if (CLIP_CHANNEL_PATTERN.test(name)) return false;
  if (OVERSEAS_PATTERN.test(name)) return false;
  return true;
}

async function main() {
  resetYoutubeQuotaUsage();

  // 既存チャンネル名セット（重複除外）
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

  saveSpreadsheetId(SPREADSHEET_ID);

  // YouTube 検索で候補収集
  const seen = new Set();
  const candidates = [];
  for (const query of SEARCH_QUERIES) {
    if (candidates.length >= 400) break;
    const results = await searchYoutubeChannels(query, 10);
    for (const r of results) {
      const key = r.channelId || r.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      // 既存 or 無効は除外
      if (existingNames.has(r.title)) continue;
      if (!isValidInvestmentChannel(r.title)) continue;
      // 既にメールあり→スキップ（discover済み）
      if (r.emailCandidates?.[0] && !PERSONAL_DOMAINS.test((r.emailCandidates[0].split("@")[1] || ""))) continue;
      candidates.push({ channelName: r.title, youtubeUrl: r.channelUrl, emailFromYT: r.emailCandidates?.[0] || "" });
    }
  }

  console.log(`深掘り対象候補: ${candidates.length}件`);

  const readyLeads = [];
  const stillUnresolved = [];

  for (const c of candidates) {
    if (readyLeads.length >= TARGET_WRITE_COUNT) break;

    // Step 1: YouTube /about から email + siteUrl を抽出
    const ytScrape = await deepScrapeYouTube(c.youtubeUrl);
    let email = ytScrape.email || c.emailFromYT || "";
    let siteUrl = ytScrape.siteUrl;
    let emailSource = email ? "YouTube" : "";

    // Step 2: siteUrl があれば公式サイトからも探す（platformドメイン除外）
    if (!email && siteUrl && !PLATFORM_DOMAINS.test(siteUrl)) {
      const contact = await discoverContactInfo({ siteUrl });
      if (contact.email) {
        email = contact.email;
        emailSource = normalizeEmailSourceForSheet(contact.emailSource);
      }
    }

    if (!email) {
      stillUnresolved.push(c.channelName);
      continue;
    }

    // 会社名・代表者名
    let companyName = "";
    let representativeName = "";
    if (siteUrl && !PLATFORM_DOMAINS.test(siteUrl)) {
      const contact = await discoverContactInfo({ siteUrl });
      companyName = sanitizeCompanyName(contact.companyName || "");
      representativeName = sanitizeRepresentativeName(contact.representativeName || "");
    }

    // チャンネル登録者数・最終投稿日を取得
    const metrics = await getYoutubeChannelMetricsByUrl(c.youtubeUrl);

    readyLeads.push({
      channelName: c.channelName,
      companyName,
      representativeName,
      youtubeUrl: c.youtubeUrl,
      email,
      emailSource: emailSource || "YouTube",
      subscriberCount: metrics?.subscriberCount || "",
      latestVideoPublishedAt: metrics?.latestVideoPublishedAt || "",
    });

    console.log(`FOUND: ${c.channelName} -> ${email}`);
  }

  // シート書き込み
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
              range: { sheetId, startRowIndex: startRow - 1, endRowIndex: startRow - 1 + preparedRows.length, startColumnIndex: 9, endColumnIndex: 11 },
              cell: { userEnteredFormat: { horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } },
              fields: "userEnteredFormat(horizontalAlignment,verticalAlignment)",
            },
          }],
        },
      });
    }
  }

  const quota = getYoutubeQuotaUsageSummary();
  writeStandardSummary({
    logDir: LOG_DIR,
    fileName: "investment-backfill-emails-summary.md",
    title: "投資リスト メール補完結果",
    overview: [
      { label: "深掘り対象候補", value: candidates.length },
      { label: "開始行", value: startRow },
      { label: "追加目標件数", value: TARGET_WRITE_COUNT },
    ],
    metrics: [
      { label: "書き込み成功", value: readyLeads.length },
      { label: "なお未発見", value: stillUnresolved.length },
      { label: "YouTube試行ユニット", value: quota.estimatedAttemptedUnits },
      { label: "YouTube残量推定", value: quota.estimatedRemainingUnits },
    ],
    sections: readyLeads.length ? [{
      heading: "書き込んだ候補",
      lines: readyLeads.map((l) => `- ${l.channelName} / ${l.email}`),
    }] : [],
  });

  console.log(`START_ROW=${startRow}`);
  console.log(`WRITTEN=${readyLeads.length}`);
  console.log(`STILL_UNRESOLVED=${stillUnresolved.length}`);
  console.log(`YOUTUBE_REMAINING_ESTIMATE=${quota.estimatedRemainingUnits}`);
}

main().catch((e) => { console.error("Error:", e.message); process.exit(1); });
