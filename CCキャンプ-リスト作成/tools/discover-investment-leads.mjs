#!/usr/bin/env node

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readSheetValues, saveSpreadsheetId, updateRows } from "./lib/sheets.mjs";
import { validateAndRepairUrl } from "./lib/url-checker.mjs";
import {
  discoverContactInfo,
  sanitizeCompanyName,
  sanitizeRepresentativeName,
} from "./lib/contact-discovery.mjs";
import {
  getYoutubeChannelMetricsByUrl,
  getYoutubeQuotaUsageSummary,
  resetYoutubeQuotaUsage,
  searchYoutubeChannels,
} from "./lib/youtube-api.mjs";
import { searchBraveWeb } from "./lib/brave-search-api.mjs";
import { searchGoogleWeb } from "./lib/google-search-api.mjs";
import { appendDatedLog, writeStandardSummary } from "./lib/summary-writer.mjs";

const SPREADSHEET_ID = "1g4_kHjFYyGpkkxtCWDdq6BHTR9pCmwT3aRHzxTV8pFY";
const ORIGINAL_SPREADSHEET_ID = "16D9nFxkfONtJV-1VmJJOA21YEnPAoy90rhMSNRWgUok";
const SHEET_NAME = "投資：メールアドレス";
const WRITER_NAME = "東たくみ";
const TARGET_WRITE_COUNT = Number(process.env.TARGET_WRITE_COUNT || "30");
const QUERY_LIMIT = Number(process.env.QUERY_LIMIT || "40");
const QUERY_RESULTS_LIMIT = Number(process.env.QUERY_RESULTS_LIMIT || "10");
const MAX_CANDIDATES = Number(process.env.MAX_CANDIDATES || "200");
const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, "..", "logs");

const SEARCH_QUERIES = [
  // NISA / 積立
  "新NISA 投資 チャンネル 公式",
  "つみたてNISA 解説 チャンネル",
  "iDeCo 確定拠出年金 チャンネル",
  "インデックスファンド 積立投資 チャンネル",
  "S&P500 全世界株式 オルカン チャンネル",
  // 株式
  "高配当株 配当金生活 チャンネル",
  "株式投資 初心者 チャンネル",
  "デイトレード スイングトレード チャンネル",
  "銘柄分析 決算分析 チャンネル",
  "米国株 ETF 投資 チャンネル",
  // 資産運用全般
  "資産運用 資産形成 チャンネル",
  "お金を増やす 資産運用 チャンネル",
  "副業 不労所得 パッシブインカム チャンネル",
  "節税 税金対策 節約 チャンネル",
  "老後資金 年金 退職金 チャンネル",
  // 不動産
  "不動産投資 家賃収入 チャンネル",
  "アパート経営 賃貸経営 チャンネル",
  "ワンルーム投資 不動産 チャンネル",
  // 仮想通貨
  "ビットコイン 仮想通貨 投資 チャンネル",
  "イーサリアム NFT Web3 チャンネル",
  // 経済 / マクロ
  "経済ニュース 世界経済 投資 チャンネル",
  "インフレ対策 円安対策 資産防衛 チャンネル",
  "金利 利回り 債券 チャンネル",
  // FP・お金の教育
  "お金の勉強 マネーリテラシー チャンネル",
  "ファイナンシャルプランナー FP 資産相談 チャンネル",
  "家計管理 節約 固定費削減 チャンネル",
  "生命保険 医療保険 見直し チャンネル",
  "住宅ローン 教育費 老後2000万 チャンネル",
  // 証券口座
  "SBI証券 楽天証券 口座開設 チャンネル",
  "ネット証券 比較 おすすめ チャンネル",
  // 複利 / シミュレーション
  "複利 年利 資産シミュレーション チャンネル",
  "20代 30代 資産形成 チャンネル",
  // コモディティ / オルタナ
  "金 ゴールド 資産運用 チャンネル",
  "ポートフォリオ リバランス 分散投資 チャンネル",
  // スタートアップ / IPO
  "スタートアップ IPO エンジェル投資 チャンネル",
  // 初心者向け
  "投資 初心者 始め方 チャンネル",
  "知らないと損 お金 投資 チャンネル",
  "お金持ち 富裕層 習慣 チャンネル",
  // 地域系FP / IFA
  "ファイナンシャルプランナー 相談 公式 チャンネル",
  "IFA 独立系 資産運用 チャンネル",
  // ── 新規追加クエリ ──
  // 職業・属性別
  "公務員 投資 資産形成",
  "医師 医者 投資 資産形成",
  "サラリーマン 投資 副業",
  "主婦 投資 家計 お金",
  "大学生 投資 奨学金 資産形成",
  "50代 60代 老後 資産運用",
  "子育て 教育費 資産形成 投資",
  // 具体的な投資手法
  "ヘッジファンド 絶対収益 投資",
  "オプション取引 先物 FX 投資",
  "グロース株 成長株 投資",
  "バリュー投資 割安株 投資",
  "配当再投資 DRIP 投資",
  "太陽光発電 投資 不動産",
  "駐車場経営 コインランドリー 投資",
  // 税務・法律
  "確定申告 投資 節税 tax",
  "相続 贈与 資産承継 チャンネル",
  "法人 節税 個人事業主 投資",
  // FIREムーブメント
  "FIRE セミリタイア 資産形成",
  "サイドFIRE 4パーセントルール",
  "早期退職 経済的自由 投資",
  // ニッチ投資
  "ワインファンド オルタナ投資",
  "アート 美術品 投資",
  "林業 農業 投資",
  "船舶 航空機 投資ファンド",
  // 地域別FP
  "東京 FP ファイナンシャルプランナー 無料相談",
  "大阪 FP ファイナンシャルプランナー 相談",
  "名古屋 FP 資産運用 相談",
  "福岡 FP 投資 相談",
  // 証券会社・金融機関系
  "証券アナリスト 投資 解説",
  "元証券マン 株 投資",
  "銀行員 投資 資産運用",
  "税理士 節税 投資",
  "社労士 年金 老後資金",
];

// 切り抜き系チャンネルの除外パターン
const CLIP_CHANNEL_PATTERN = /切り抜き|きりぬき|切抜き|clip channel/i;
// 海外チャンネルの除外パターン（英語のみタイトル ＋ 明らかに海外）
const OVERSEAS_PATTERN = /^[a-zA-Z0-9\s\-_!?.,'"@#$%&*()[\]{}|/\\+=<>~`]+$/;

function normalizeEmailSourceForSheet(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/facebook/i.test(text)) return "Facebook";
  if (/youtube|概要欄|説明欄/i.test(text)) return "YouTube";
  if (/google|brave|search/i.test(text)) return "その他（Google検索）";
  if (/contact|inquiry|request|support/i.test(text)) return "その他（問い合わせフォーム）";
  if (/tokusho|specified-commercial|tradelaw|legal-notice|terms/i.test(text)) return "その他（特商法）";
  if (/privacy|policy/i.test(text)) return "その他（プライバシーポリシー）";
  if (/company|profile|about|outline|info\.html/i.test(text)) return "その他（会社概要）";
  return "その他（HP）";
}

function appendDiscoveryLog(lines) {
  appendDatedLog({ logDir: LOG_DIR, prefix: "investment-discovery", lines });
}

function findHeaderRow(rows) {
  return rows.findIndex(
    (row) => row[0] === "No" && String(row[1] || "").includes("記入者の名前")
  );
}

function findStartRow(rows, headerRowIndex) {
  let lastFilledRowNumber = headerRowIndex + 1;
  for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
    if (String(rows[index]?.[1] || "").trim()) {
      lastFilledRowNumber = index + 1;
    }
  }
  return lastFilledRowNumber + 1;
}

function looksLikeOfficialSite(url) {
  return (
    !!url &&
    !/youtube\.com|youtu\.be|google\.com|instagram\.com|x\.com|twitter\.com|facebook\.com/i.test(url)
  );
}

function isValidInvestmentChannel(channelName) {
  if (CLIP_CHANNEL_PATTERN.test(channelName)) return false;
  // 完全に英数字のみ（海外チャンネル）は除外
  if (OVERSEAS_PATTERN.test(channelName)) return false;
  return true;
}

async function resolveMetadataFromSearch(channelName) {
  let searchResults = [];
  let braveInfobox = null;
  try {
    const brave = await searchBraveWeb(`${channelName} 公式サイト`, 5);
    searchResults = brave.results;
    braveInfobox = brave.infobox;
  } catch {
    searchResults = [];
  }
  if (!searchResults.length) {
    try {
      searchResults = await searchGoogleWeb(`${channelName} 公式サイト`, 5);
    } catch {
      searchResults = [];
    }
  }
  const siteUrl =
    braveInfobox?.websiteUrl ||
    searchResults.find((item) => looksLikeOfficialSite(item.link))?.link ||
    "";
  const contact = siteUrl
    ? await discoverContactInfo({ siteUrl })
    : { companyName: "", representativeName: "" };
  return {
    siteUrl,
    companyName: sanitizeCompanyName(braveInfobox?.companyName || contact.companyName || ""),
    representativeName: sanitizeRepresentativeName(
      braveInfobox?.representativeName || contact.representativeName || ""
    ),
  };
}

async function collectCandidates(maxCandidates) {
  const candidates = [];
  const seen = new Set();
  for (const query of SEARCH_QUERIES.slice(0, QUERY_LIMIT)) {
    const youtubeResults = await searchYoutubeChannels(query, QUERY_RESULTS_LIMIT);
    for (const result of youtubeResults) {
      const dedupeKey = result.channelId || result.title;
      if (!dedupeKey || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      candidates.push({
        channelName: result.title,
        siteUrl: result.websiteCandidates?.[0] || "",
        youtubeUrl: result.channelUrl,
        emailFromYoutube: result.emailCandidates?.[0] || "",
        sourceLabel: "YouTube API",
      });
      if (candidates.length >= maxCandidates) {
        return candidates.sort((a, b) => Number(Boolean(b.emailFromYoutube)) - Number(Boolean(a.emailFromYoutube)));
      }
    }
  }
  return candidates.sort((a, b) => Number(Boolean(b.emailFromYoutube)) - Number(Boolean(a.emailFromYoutube)));
}

async function main() {
  resetYoutubeQuotaUsage();

  saveSpreadsheetId(SPREADSHEET_ID);
  const rows = await readSheetValues(SHEET_NAME, "A:K");
  const headerRowIndex = findHeaderRow(rows);
  if (headerRowIndex === -1) throw new Error("ヘッダー行が見つかりませんでした");
  const startRow = findStartRow(rows, headerRowIndex);

  // 重複チェック：コピー＋オリジナル両方のチャンネル名を合算
  saveSpreadsheetId(ORIGINAL_SPREADSHEET_ID);
  const originalRows = await readSheetValues(SHEET_NAME, "A:G");
  const originalHeaderIdx = findHeaderRow(originalRows);
  const existingChannelNames = new Set([
    ...rows.slice(headerRowIndex + 1).map((r) => String(r[2] || "").trim()).filter(Boolean),
    ...(originalHeaderIdx >= 0
      ? originalRows.slice(originalHeaderIdx + 1).map((r) => String(r[2] || "").trim()).filter(Boolean)
      : []),
  ]);

  saveSpreadsheetId(SPREADSHEET_ID);

  let candidates = [];
  try {
    candidates = await collectCandidates(MAX_CANDIDATES);
  } catch (error) {
    appendDiscoveryLog([`[${new Date().toISOString()}] API候補取得失敗`, error.message]);
  }

  const readyLeads = [];
  const unresolved = [];

  for (const candidate of candidates) {
    if (readyLeads.length >= TARGET_WRITE_COUNT) break;
    if (existingChannelNames.has(candidate.channelName.trim())) continue;
    if (!isValidInvestmentChannel(candidate.channelName.trim())) continue;

    const checkedYoutubeUrl = await validateAndRepairUrl(candidate.youtubeUrl);
    const metadata = await resolveMetadataFromSearch(candidate.channelName);
    const resolvedSiteUrl = candidate.siteUrl || metadata.siteUrl;
    const contact = resolvedSiteUrl
      ? await discoverContactInfo({ siteUrl: resolvedSiteUrl })
      : { email: "", companyName: "", representativeName: "", emailSource: "", logs: [] };

    const lead = {
      channelName: candidate.channelName,
      companyName: sanitizeCompanyName(metadata.companyName || contact.companyName || ""),
      representativeName: sanitizeRepresentativeName(
        metadata.representativeName || contact.representativeName || ""
      ),
      youtubeUrl: checkedYoutubeUrl.finalValue || candidate.youtubeUrl,
      email: candidate.emailFromYoutube || contact.email || "",
      emailSource: normalizeEmailSourceForSheet(
        candidate.emailFromYoutube ? "YouTube説明欄" : contact.emailSource || candidate.sourceLabel
      ),
    };

    if (lead.email) {
      // チャンネル登録者数・最終投稿日を取得
      const metrics = await getYoutubeChannelMetricsByUrl(lead.youtubeUrl);
      lead.subscriberCount = metrics?.subscriberCount || "";
      lead.latestVideoPublishedAt = metrics?.latestVideoPublishedAt || "";
      readyLeads.push(lead);
    } else {
      unresolved.push({
        ...lead,
        siteUrl: resolvedSiteUrl,
        logs: [...checkedYoutubeUrl.logs, ...contact.logs],
      });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const preparedRows = readyLeads.slice(0, TARGET_WRITE_COUNT).map((lead) => [
    WRITER_NAME,
    lead.channelName,
    lead.companyName,
    lead.representativeName,
    lead.youtubeUrl,
    lead.email,
    lead.emailSource,
    lead.subscriberCount,
    lead.latestVideoPublishedAt,
    today,
  ]);

  if (preparedRows.length) {
    await updateRows(SHEET_NAME, startRow, 1, preparedRows);

    // J・K列（最終投稿日・取得日）の書式をCENTER+MIDDLEに設定
    const sheets = (await import('./lib/sheets.mjs')).getSheetsClient
      ? await (await import('./lib/sheets.mjs')).getSheetsClient()
      : null;
    if (sheets) {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
      const sheetId = meta.data.sheets.find((s) => s.properties.title === SHEET_NAME)?.properties.sheetId;
      if (sheetId !== undefined) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
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
    }
  }

  const quotaSummary = getYoutubeQuotaUsageSummary();
  const sections = [];

  if (readyLeads.length) {
    sections.push({
      heading: "書き込んだ候補",
      lines: readyLeads.map((l) => `- ${l.channelName} / ${l.email}`),
    });
  }

  if (unresolved.length) {
    const unresolvedLines = [];
    for (const lead of unresolved) {
      unresolvedLines.push(`- ${lead.channelName} / site: ${lead.siteUrl}`);
      unresolvedLines.push(`  ログ: ${lead.logs.join(" | ")}`);
      appendDiscoveryLog([
        `[${new Date().toISOString()}] ${lead.channelName}`,
        `site=${lead.siteUrl}`,
        ...lead.logs,
      ]);
    }
    sections.push({ heading: "メール未発見", lines: unresolvedLines });
  }

  writeStandardSummary({
    logDir: LOG_DIR,
    fileName: "investment-lead-discovery-summary.md",
    title: "投資業界リスト探索結果",
    overview: [
      { label: "開始行", value: startRow },
      { label: "候補数", value: candidates.length },
      { label: "追加目標件数", value: TARGET_WRITE_COUNT },
    ],
    metrics: [
      { label: "書き込み成功", value: readyLeads.length },
      { label: "メール未発見", value: unresolved.length },
      { label: "YouTube試行ユニット", value: quotaSummary.estimatedAttemptedUnits },
      { label: "YouTube残量推定", value: quotaSummary.estimatedRemainingUnits },
    ],
    sections,
  });

  console.log(`START_ROW=${startRow}`);
  console.log(`WRITTEN=${readyLeads.length}`);
  console.log(`UNRESOLVED=${unresolved.length}`);
  console.log(`YOUTUBE_ATTEMPTED_UNITS=${quotaSummary.estimatedAttemptedUnits}`);
  console.log(`YOUTUBE_REMAINING_ESTIMATE=${quotaSummary.estimatedRemainingUnits}`);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
