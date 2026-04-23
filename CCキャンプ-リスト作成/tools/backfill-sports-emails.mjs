#!/usr/bin/env node
/**
 * スポーツ用品リスト メール補完スクリプト
 * discover-youtube-sales-leads.mjs で「メール未発見」だったチャンネルに対して
 * YouTube /about ページの description から直接メールを抽出して書き込む
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  readSheetValues, saveSpreadsheetId, getSheetsClient,
  getSpreadsheetId, updateRows,
} from "./lib/sheets.mjs";
import {
  searchYoutubeChannels, getYoutubeChannelMetricsByUrl,
  getYoutubeQuotaUsageSummary, resetYoutubeQuotaUsage,
} from "./lib/youtube-api.mjs";
import { discoverContactInfo, sanitizeCompanyName, sanitizeRepresentativeName } from "./lib/contact-discovery.mjs";
import { appendDatedLog, writeStandardSummary } from "./lib/summary-writer.mjs";

const SPREADSHEET_ID = "1E7sL6TjDiGWUF77uMAc88XK7OzXXS8wgDgwInI5Ad1c";
const ORIGINAL_SPREADSHEET_ID = "1WG00opfjyNsUO6Apr-IEbH1KxmDlYyaGjPoV6LDnJd0";
const SHEET_NAME = "スポーツ用品業界：メールアドレス";
const WRITER_NAME = "東たくみ";
const TARGET_WRITE_COUNT = Number(process.env.TARGET_WRITE_COUNT || "25");
const QUERY_LIMIT = Number(process.env.QUERY_LIMIT || "60");
const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, "..", "logs");

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "ja,en;q=0.9",
};
const EMAIL_REGEX = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;
const PERSONAL_EMAIL_DOMAINS = /^(gmail|yahoo|hotmail|outlook|icloud|me|live|msn|googlemail)\./i;
const PLATFORM_DOMAINS = /note\.com|lin\.ee|line\.me|ameblo\.jp|amzn\.|bit\.ly|lit\.link|linktr\.ee|forms\.gle|docs\.google\.com/i;

const SEARCH_QUERIES = [
  "北海道 スポーツ用品店 公式", "東北 スポーツ用品店 公式",
  "北関東 スポーツ用品店 公式", "東海 スポーツ用品店 公式",
  "関西 スポーツ用品店 公式", "中国 四国 スポーツ用品店 公式",
  "九州 スポーツ用品店 公式", "沖縄 スポーツ用品 公式",
  "アーチェリー 弓具店 公式", "フェンシング 用具 販売 公式",
  "ボクシング グローブ 販売 公式", "レスリング 柔術 用品店 公式",
  "トライアスロン 用品店 公式", "カヌー カヤック 用品 公式",
  "ロッククライミング 用品店 公式", "スケートボード 用品店 公式",
  "ラクロス フィールドホッケー 用品 公式", "ソフトボール 用品店 公式",
  "スポーツ消耗品 用品メーカー 公式", "野球グローブ メーカー 公式チャンネル",
  "ゴルフシャフト メーカー 公式", "テニスガット メーカー 公式",
  "スポーツテーピング サポーター メーカー 公式", "トレーニングウェア メーカー 公式チャンネル",
  "スポーツ栄養 プロテイン メーカー 公式", "スポーツ用品 卸売 メーカー 公式",
  "学校体育 用品 メーカー 公式", "スポーツ安全用具 プロテクター 販売 公式",
  "剣道 防具 道着 専門店 公式", "弓道 弓具 矢 専門店 公式",
  "空手 道着 防具 専門店 公式", "合気道 柔道 武道 用品店 公式",
  "馬術 乗馬 馬具 用品店 公式", "自転車 サイクル 用品店 公式",
  "スノーボード スキー 用品店 公式", "サーフィン ウィンドサーフィン 用品店 公式",
  "マリンスポーツ ダイビング 用品店 公式", "ハンドボール バレーボール 専門店 公式",
  "バドミントン 専門店 用品 公式", "卓球 専門店 ラケット 公式",
  "水泳 競泳 水着 専門店 公式", "陸上 マラソン シューズ 専門店",
  "バスケットボール 専門店 公式チャンネル", "ラグビー アメフト 用品店 公式",
  "格闘技 MMA 用品 販売 公式", "スポーツ用品 オリジナル ブランド 公式",
  "スポーツ アパレル ウェア 国内 メーカー 公式", "スポーツ シューズ 専門 メーカー 公式",
  "球技 ボール 製造 メーカー 公式", "北陸 石川 富山 スポーツ用品 公式",
  "信越 長野 新潟 スポーツ用品 公式", "関東 埼玉 千葉 スポーツ用品店 公式",
  "関西 京都 奈良 スポーツ用品店 公式", "学校 部活動 スポーツ 用品 公式",
  "チーム ユニフォーム オーダー スポーツ 公式", "スポーツ チームウェア 制作 公式",
  "フィットネス トレーニング 器具 専門 公式", "ヨガ ピラティス 用品 マット 公式",
  "ダンス チア 衣装 用品 公式", "e-スポーツ ゲーミングチェア デバイス 公式",
];

const SPORTS_GOODS_KEYWORDS = /スポーツ用品|sport.*goods|用品|スポーツ|sport|アウトドア|outdoor|フィットネス|fitness|ゴルフ|golf|野球|テニス|サッカー|バスケ|バドミントン|卓球|剣道|弓道|柔道|空手|格闘技|武道|登山|ハイキング|サーフィン|スキー|スノーボード|自転車|サイクル|ランニング|マラソン|水泳|競泳|ウェットスーツ|グローブ|ラケット|乗馬|馬具|ダイビング|ヨガ|ピラティス|ダンス|チア|トレーニング/i;
const EXCLUDED_INDUSTRIES = /ボウリング|bowling|釣り|fishing|つり|フィッシング/i;
const CHANNEL_BLACKLIST = new Set([
  "シュアラスター スポーツ",       // 自動車ケア用品（スポーツ用品ではない）
  "ガンバ大阪チアダンスチーム 公式YouTubeチャンネル", // サッカークラブのチア（用品店ではない）
]);
const CLIP_CHANNEL_PATTERN = /切り抜き|きりぬき|切抜き/i;
const OVERSEAS_PATTERN = /^[a-zA-Z0-9\s\-_!?.,'"@#$%&*()[\]{}|/\\+=<>~`]+$/;

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
      if (--depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; } }
    }
  }
  return null;
}

function findDeep(obj, key, depth = 0) {
  if (depth > 12 || !obj || typeof obj !== "object") return null;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) { const r = findDeep(v, key, depth + 1); if (r) return r; }
  return null;
}

function findDeepString(obj, key, depth = 0) {
  if (depth > 15 || !obj || typeof obj !== "object") return "";
  if (key in obj) { const val = obj[key]; if (typeof val === "string" && val.length > 5) return val; }
  for (const v of Object.values(obj)) { const r = findDeepString(v, key, depth + 1); if (r) return r; }
  return "";
}

function decodeYoutubeRedirect(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "www.youtube.com" && u.pathname === "/redirect")
      return decodeURIComponent(u.searchParams.get("q") || "");
    return url;
  } catch { return url; }
}

function looksLikeOfficialSite(url) {
  if (!url) return false;
  return !/youtube\.com|youtu\.be|google\.com|instagram\.com|x\.com|twitter\.com|facebook\.com|line\.me|ameblo|note\.com|tiktok\.com|linktr\.ee|amzn\.|bit\.ly|lit\.link/i.test(url);
}

async function fetchHtml(url, ms = 15000) {
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, redirect: "follow", signal: AbortSignal.timeout(ms) });
    return { ok: res.ok, text: res.ok ? await res.text() : "", finalUrl: res.url || url };
  } catch { return { ok: false, text: "", finalUrl: url }; }
}

async function deepScrapeYouTube(youtubeUrl) {
  const result = { email: "", siteUrl: "" };
  if (!youtubeUrl) return result;
  const base = youtubeUrl.replace(/\/(about\/?|featured\/?|videos\/?)$/, "").replace(/\/$/, "");
  const res = await fetchHtml(`${base}/about`, 20000);
  if (!res.ok || !res.text) return result;
  const data = extractYtInitialData(res.text);
  if (!data) return result;
  // Description: try new channelMetadataRenderer first, then old channelAboutFullMetadataRenderer
  const metaRenderer = findDeep(data, "channelMetadataRenderer");
  const metadata = findDeep(data, "channelAboutFullMetadataRenderer");
  const desc = (typeof metaRenderer?.description === "string" ? metaRenderer.description : "")
    || (typeof metadata?.description === "string" ? metadata.description : "")
    || metadata?.description?.simpleText || findDeepString(data, "description") || "";
  const emails = (desc.match(EMAIL_REGEX) || []).filter(e => !PERSONAL_EMAIL_DOMAINS.test(e.split("@")[1] || ""));
  if (emails.length) result.email = emails[0];
  // Site URL: try new structure (channelExternalLinkViewModel redirect URLs) first
  const dataStr = JSON.stringify(data);
  const redirectRE = /"url":"(https:\/\/www\.youtube\.com\/redirect\?[^"]+)"/g;
  for (const m of dataStr.matchAll(redirectRE)) {
    const decoded = decodeYoutubeRedirect(m[1].replace(/\\u0026/g, "&"));
    if (decoded && looksLikeOfficialSite(decoded)) { result.siteUrl = decoded; break; }
  }
  // Also try old channelHeaderLinksRenderer structure
  if (!result.siteUrl) {
    const headerLinks = findDeep(data, "channelHeaderLinksRenderer");
    for (const group of [headerLinks?.primaryLinks, headerLinks?.secondaryLinks, metadata?.primaryLinks]) {
      if (!group) continue;
      for (const link of group) {
        const decoded = decodeYoutubeRedirect(link?.navigationEndpoint?.urlEndpoint?.url || "");
        if (decoded && looksLikeOfficialSite(decoded)) { result.siteUrl = decoded; break; }
      }
      if (result.siteUrl) break;
    }
  }
  if (!result.siteUrl && desc) {
    for (const u of (desc.match(/https?:\/\/[^\s\u3000-\u9fff）)]+/g) || [])) {
      const clean = u.replace(/[)>\]'"。、]+$/, "");
      if (looksLikeOfficialSite(clean)) { result.siteUrl = clean; break; }
    }
  }
  return result;
}

function findHeaderRow(rows) {
  return rows.findIndex(r => r[0] === "No" && String(r[1] || "").includes("記入者の名前"));
}
function findStartRow(rows, headerRowIndex) {
  let last = headerRowIndex + 1;
  for (let i = headerRowIndex + 1; i < rows.length; i++) if (String(rows[i]?.[1] || "").trim()) last = i + 1;
  return last + 1;
}
function normalizeEmailSourceForSheet(value) {
  const t = String(value || "").trim();
  if (/youtube|概要欄/i.test(t)) return "YouTube";
  if (/tokusho|tradelaw/i.test(t)) return "その他（特商法）";
  if (/company|profile|about/i.test(t)) return "その他（会社概要）";
  if (/contact|inquiry/i.test(t)) return "その他（問い合わせフォーム）";
  return "その他（HP）";
}

async function main() {
  resetYoutubeQuotaUsage();

  saveSpreadsheetId(SPREADSHEET_ID);
  const copyRows = await readSheetValues(SHEET_NAME, "A:K");
  const copyHi = findHeaderRow(copyRows);
  const startRow = findStartRow(copyRows, copyHi);

  saveSpreadsheetId(ORIGINAL_SPREADSHEET_ID);
  const origRows = await readSheetValues(SHEET_NAME, "A:C");
  const origHi = findHeaderRow(origRows);
  const existingNames = new Set([
    ...copyRows.slice(copyHi + 1).map(r => String(r[2] || "").trim()).filter(Boolean),
    ...(origHi >= 0 ? origRows.slice(origHi + 1).map(r => String(r[2] || "").trim()).filter(Boolean) : []),
  ]);
  console.log(`既存チャンネル数: ${existingNames.size}`);
  saveSpreadsheetId(SPREADSHEET_ID);

  // YouTube 検索で候補収集（メールなし = 深掘り対象）
  const seen = new Set();
  const candidates = [];
  for (const query of SEARCH_QUERIES.slice(0, QUERY_LIMIT)) {
    if (candidates.length >= 500) break;
    const results = await searchYoutubeChannels(query, 15);
    for (const r of results) {
      const key = r.channelId || r.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (existingNames.has(r.title.trim())) continue;
      if (CHANNEL_BLACKLIST.has(r.title.trim())) continue;
      if (CLIP_CHANNEL_PATTERN.test(r.title) || OVERSEAS_PATTERN.test(r.title)) continue;
      if (EXCLUDED_INDUSTRIES.test(r.title)) continue;
      if (!SPORTS_GOODS_KEYWORDS.test(r.title)) continue;
      // メールあり→discover済みなのでスキップ
      if (r.emailCandidates?.[0] && !PERSONAL_EMAIL_DOMAINS.test(r.emailCandidates[0].split("@")[1] || "")) continue;
      candidates.push({ channelName: r.title, youtubeUrl: r.channelUrl });
    }
  }
  console.log(`深掘り対象候補: ${candidates.length}件`);

  const readyLeads = [];
  const stillUnresolved = [];

  for (const c of candidates) {
    if (readyLeads.length >= TARGET_WRITE_COUNT) break;

    const ytScrape = await deepScrapeYouTube(c.youtubeUrl);
    let email = ytScrape.email;
    let siteUrl = ytScrape.siteUrl;
    let emailSource = email ? "YouTube" : "";

    if (!email && siteUrl && !PLATFORM_DOMAINS.test(siteUrl)) {
      const contact = await discoverContactInfo({ siteUrl });
      if (contact.email && !PERSONAL_EMAIL_DOMAINS.test(contact.email.split("@")[1] || "")) {
        email = contact.email;
        emailSource = normalizeEmailSourceForSheet(contact.emailSource);
      }
    }

    if (!email) { stillUnresolved.push(c.channelName); continue; }

    // 会社名・代表者名
    let companyName = "", representativeName = "";
    if (siteUrl && !PLATFORM_DOMAINS.test(siteUrl)) {
      const contact = await discoverContactInfo({ siteUrl });
      companyName = sanitizeCompanyName(contact.companyName || "");
      representativeName = sanitizeRepresentativeName(contact.representativeName || "");
    }

    // スポーツ用品チェック（会社名も含めて再判定）
    const isCompanyEmail = !PERSONAL_EMAIL_DOMAINS.test(email.split("@")[1] || "");
    const hasLegal = /株式会社|有限会社|合同会社|一般社団法人/.test(companyName);
    if (!SPORTS_GOODS_KEYWORDS.test(c.channelName)) { stillUnresolved.push(c.channelName); continue; }
    if (!hasLegal && !isCompanyEmail) { stillUnresolved.push(c.channelName); continue; }
    if (EXCLUDED_INDUSTRIES.test(c.channelName)) { stillUnresolved.push(c.channelName); continue; }

    existingNames.add(c.channelName.trim());
    const metrics = await getYoutubeChannelMetricsByUrl(c.youtubeUrl);
    readyLeads.push({
      channelName: c.channelName, companyName, representativeName,
      youtubeUrl: c.youtubeUrl, email, emailSource: emailSource || "YouTube",
      subscriberCount: metrics?.subscriberCount || "",
      latestVideoPublishedAt: metrics?.latestVideoPublishedAt || "",
    });
    console.log(`FOUND [${readyLeads.length}]: ${c.channelName} -> ${email}`);
  }

  if (readyLeads.length) {
    const today = new Date().toISOString().slice(0, 10);
    const preparedRows = readyLeads.map(l => [
      WRITER_NAME, l.channelName, l.companyName, l.representativeName,
      l.youtubeUrl, l.email, l.emailSource, l.subscriberCount, l.latestVideoPublishedAt, today,
    ]);
    await updateRows(SHEET_NAME, startRow, 1, preparedRows);
    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetId = meta.data.sheets.find(s => s.properties.title === SHEET_NAME)?.properties.sheetId;
    if (sheetId !== undefined) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ repeatCell: {
        range: { sheetId, startRowIndex: startRow-1, endRowIndex: startRow-1+preparedRows.length, startColumnIndex: 9, endColumnIndex: 11 },
        cell: { userEnteredFormat: { horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } },
        fields: "userEnteredFormat(horizontalAlignment,verticalAlignment)",
      }}]}});
    }
    console.log(`書き込み完了: row${startRow}〜row${startRow + preparedRows.length - 1}`);
  }

  const quota = getYoutubeQuotaUsageSummary();
  writeStandardSummary({
    logDir: LOG_DIR, fileName: "sports-backfill-emails-summary.md",
    title: "スポーツ用品リスト メール補完結果",
    overview: [{ label: "深掘り対象候補", value: candidates.length }, { label: "開始行", value: startRow }],
    metrics: [
      { label: "書き込み成功", value: readyLeads.length },
      { label: "なお未発見", value: stillUnresolved.length },
      { label: "YouTube試行ユニット", value: quota.estimatedAttemptedUnits },
      { label: "YouTube残量推定", value: quota.estimatedRemainingUnits },
    ],
    sections: readyLeads.length ? [{ heading: "書き込んだ候補", lines: readyLeads.map(l => `- ${l.channelName} / ${l.email}`) }] : [],
  });

  console.log(`START_ROW=${startRow}`);
  console.log(`WRITTEN=${readyLeads.length}`);
  console.log(`STILL_UNRESOLVED=${stillUnresolved.length}`);
  console.log(`YOUTUBE_REMAINING_ESTIMATE=${quota.estimatedRemainingUnits}`);
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
