#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
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
  getYoutubeQuotaUsageSummary,
  resetYoutubeQuotaUsage,
  searchYoutubeChannels,
} from "./lib/youtube-api.mjs";
import { searchGoogleWeb } from "./lib/google-search-api.mjs";
import { searchBraveWeb } from "./lib/brave-search-api.mjs";

const SPREADSHEET_ID = "1E7sL6TjDiGWUF77uMAc88XK7OzXXS8wgDgwInI5Ad1c";
const SHEET_NAME = "スポーツ用品業界：メールアドレス";
const WRITER_NAME = "東たくみ";
const TARGET_WRITE_COUNT = Number(process.env.TARGET_WRITE_COUNT || "30");
const ENABLE_BACKFILL = false;
const QUERY_LIMIT = Number(process.env.QUERY_LIMIT || "14");
const QUERY_RESULTS_LIMIT = Number(process.env.QUERY_RESULTS_LIMIT || "10");
const MAX_CANDIDATES = Number(process.env.MAX_CANDIDATES || "120");
const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, "..", "logs");
const RESULT_PATH = join(LOG_DIR, "youtube-lead-discovery-summary.md");

const FALLBACK_CANDIDATES = [
  {
    channelName: "MIZUNO BASEBALL JP",
    siteUrl: "corp.mizuno.com/jp",
    youtubeUrl: "https://www.youtube.com/channel/UCtu4byFPW6ovffk_c4he5BA",
    sourceLabel: "YouTube + 公式サイト",
  },
  {
    channelName: "OSHMAN'S JAPAN",
    siteUrl: "www.oshmans.co.jp",
    youtubeUrl: "https://www.youtube.com/@oshmans_japan",
    sourceLabel: "YouTube + 公式サイト",
  },
  {
    channelName: "SELECTION(セレクション)",
    siteUrl: "www.selection-j.com",
    youtubeUrl: "https://www.youtube.com/watch?v=OvW9rIJoz70",
    sourceLabel: "YouTube + 公式サイト",
  },
  {
    channelName: "ダイワスポーツofficial",
    siteUrl: "daiwa-sports.jp",
    youtubeUrl: "https://www.youtube.com/channel/UChiL6tZK2EgnsdrKnEdf93A",
    sourceLabel: "YouTube + 公式サイト",
  },
  {
    channelName: "PhitenJapan",
    siteUrl: "www.phiten.com",
    youtubeUrl: "http://www.youtube.com/user/PhitenJapan",
    sourceLabel: "YouTube + 公式サイト",
  },
];

const SEARCH_QUERIES = [
  "スポーツ用品 公式",
  "野球用品 公式",
  "ゴルフ用品 公式",
  "テニス用品 公式",
  "サッカー用品 公式",
  "ランニング用品 公式",
  "アウトドア用品 公式",
  "フィットネス用品 公式",
  "バスケットボール用品 公式",
  "バドミントン用品 公式",
  "卓球用品 公式",
  "登山用品 公式",
  "トレーニング用品 公式",
  "マラソン用品 公式",
];

function normalizeEmailSourceForSheet(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (/facebook/i.test(text)) {
    return "Facebook";
  }
  if (/youtube|概要欄|説明欄/i.test(text)) {
    return "YouTube";
  }
  if (/google|brave|search/i.test(text)) {
    return "その他（Google検索）";
  }
  if (/contact|inquiry|request|support|line_support/i.test(text)) {
    return "その他（問い合わせフォーム）";
  }
  if (
    /tokusho|specified-commercial|tradelaw|legal-notice|shop\/pages\/law|shop\/law|terms|mode=sk|business-deal/i.test(
      text
    )
  ) {
    return "その他（特商法）";
  }
  if (/privacy|policy|security/i.test(text)) {
    return "その他（プライバシーポリシー）";
  }
  if (/company|profile|about|outline|info\.html/i.test(text)) {
    return "その他（会社概要）";
  }
  return "その他（HP）";
}

function ensureLogDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function writeSummary(content) {
  ensureLogDir();
  writeFileSync(RESULT_PATH, content, "utf-8");
}

function appendDiscoveryLog(lines) {
  ensureLogDir();
  const datedPath = join(LOG_DIR, `lead-discovery-${new Date().toISOString().slice(0, 10)}.log`);
  appendFileSync(datedPath, `${lines.join("\n")}\n\n`, "utf-8");
}

function findHeaderRow(rows) {
  return rows.findIndex(
    (row) => row[0] === "No" && String(row[1] || "").includes("記入者の名前")
  );
}

function findStartRow(rows, headerRowIndex) {
  let lastFilledRowNumber = headerRowIndex + 1;

  for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
    const writerName = String(rows[index]?.[1] || "").trim();
    if (writerName) {
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
    braveInfobox?.websiteUrl || searchResults.find((item) => looksLikeOfficialSite(item.link))?.link || "";
  const contact = siteUrl ? await discoverContactInfo({ siteUrl }) : { companyName: "", representativeName: "" };

  return {
    siteUrl,
    companyName: sanitizeCompanyName(braveInfobox?.companyName || contact.companyName || ""),
    representativeName: sanitizeRepresentativeName(
      braveInfobox?.representativeName || contact.representativeName || ""
    ),
  };
}

async function collectCandidates(maxCandidates = 120) {
  const candidates = [];
  const seen = new Set();

  for (const query of SEARCH_QUERIES.slice(0, QUERY_LIMIT)) {
    const youtubeResults = await searchYoutubeChannels(query, QUERY_RESULTS_LIMIT);

    for (const result of youtubeResults) {
      const dedupeKey = result.channelId || result.title;
      if (!dedupeKey || seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      candidates.push({
        channelName: result.title,
        siteUrl: result.websiteCandidates?.[0] || "",
        youtubeUrl: result.channelUrl,
        emailFromYoutube: result.emailCandidates?.[0] || "",
        companyNameHint: "",
        representativeNameHint: "",
        sourceLabel: "YouTube API + Brave Search API",
      });

      if (candidates.length >= maxCandidates) {
        return candidates.sort((left, right) => Number(Boolean(right.emailFromYoutube)) - Number(Boolean(left.emailFromYoutube)));
      }
    }
  }

  return candidates.sort((left, right) => Number(Boolean(right.emailFromYoutube)) - Number(Boolean(left.emailFromYoutube)));
}

async function backfillExistingMetadata(rows, headerRowIndex) {
  const updates = [];

  for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const writerName = String(row[1] || "").trim();
    const channelName = String(row[2] || "").trim();
    const companyName = String(row[3] || "").trim();
    const representativeName = String(row[4] || "").trim();

    if (writerName !== WRITER_NAME || !channelName || (companyName && representativeName)) {
      continue;
    }

    const metadata = await resolveMetadataFromSearch(channelName);
    const nextCompanyName = companyName || metadata.companyName;
    const nextRepresentativeName = representativeName || metadata.representativeName;

    if (nextCompanyName !== companyName || nextRepresentativeName !== representativeName) {
      await updateRows(SHEET_NAME, index + 1, 3, [[nextCompanyName, nextRepresentativeName]]);
      updates.push({
        rowNumber: index + 1,
        channelName,
        companyName: nextCompanyName,
        representativeName: nextRepresentativeName,
      });
    }
  }

  return updates;
}

async function main() {
  resetYoutubeQuotaUsage();
  saveSpreadsheetId(SPREADSHEET_ID);
  const rows = await readSheetValues(SHEET_NAME, "A:K");
  const headerRowIndex = findHeaderRow(rows);
  if (headerRowIndex === -1) {
    throw new Error("ヘッダー行が見つかりませんでした");
  }

  const backfilledRows = ENABLE_BACKFILL ? await backfillExistingMetadata(rows, headerRowIndex) : [];
  const startRow = findStartRow(rows, headerRowIndex);
  const existingChannelNames = new Set(
    rows.slice(headerRowIndex + 1).map((row) => String(row[2] || "").trim()).filter(Boolean)
  );
  const readyLeads = [];
  const unresolved = [];
  let candidates = [];

  try {
    candidates = await collectCandidates(MAX_CANDIDATES);
  } catch (error) {
    appendDiscoveryLog([`[${new Date().toISOString()}] API候補取得失敗`, error.message]);
  }

  if (!candidates.length) {
    candidates = FALLBACK_CANDIDATES;
  }

  for (const candidate of candidates) {
    if (readyLeads.length >= TARGET_WRITE_COUNT) {
      break;
    }

    if (existingChannelNames.has(candidate.channelName)) {
      continue;
    }

    const checkedYoutubeUrl = await validateAndRepairUrl(candidate.youtubeUrl);
    const metadata =
      candidate.siteUrl && candidate.companyNameHint && candidate.representativeNameHint
        ? {
            siteUrl: candidate.siteUrl,
            companyName: candidate.companyNameHint,
            representativeName: candidate.representativeNameHint,
          }
        : await resolveMetadataFromSearch(candidate.channelName);
    const resolvedSiteUrl = candidate.siteUrl || metadata.siteUrl;
    const contact = resolvedSiteUrl
      ? await discoverContactInfo({ siteUrl: resolvedSiteUrl })
      : { email: "", companyName: "", representativeName: "", emailSource: "", logs: [] };

    const lead = {
      channelName: candidate.channelName,
      companyName: sanitizeCompanyName(
        metadata.companyName || candidate.companyNameHint || contact.companyName
      ),
      representativeName: sanitizeRepresentativeName(
        metadata.representativeName || candidate.representativeNameHint || contact.representativeName
      ),
      youtubeUrl: checkedYoutubeUrl.finalValue || candidate.youtubeUrl,
      email: candidate.emailFromYoutube || contact.email,
      emailSource: normalizeEmailSourceForSheet(
        candidate.emailFromYoutube ? "YouTube説明欄" : contact.emailSource || candidate.sourceLabel
      ),
    };

    if (lead.email) {
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
  const preparedRows = readyLeads.slice(0, TARGET_WRITE_COUNT).map((lead, index) => [
    String(startRow - (headerRowIndex + 1) + index),
    WRITER_NAME,
    lead.channelName,
    lead.companyName,
    lead.representativeName,
    lead.youtubeUrl,
    lead.email,
    lead.emailSource,
    "",
    "",
    today,
  ]);

  if (preparedRows.length) {
    await updateRows(SHEET_NAME, startRow, 0, preparedRows);
  }

  const summaryLines = [
    "# YouTube営業リスト探索結果",
    "",
    `既存空欄の補完: ${backfilledRows.length}`,
    `開始行: ${startRow}`,
    `候補数: ${candidates.length}`,
    `追加目標件数: ${TARGET_WRITE_COUNT}`,
    `書き込み成功: ${readyLeads.length}`,
    `メール未発見: ${unresolved.length}`,
  ];

  if (backfilledRows.length) {
    summaryLines.push("");
    summaryLines.push("## 補完した既存行");
    for (const row of backfilledRows) {
      summaryLines.push(`- ${row.rowNumber}行目 ${row.channelName} / ${row.companyName || "-"} / ${row.representativeName || "-"}`);
    }
  }

  if (readyLeads.length) {
    summaryLines.push("");
    summaryLines.push("## 書き込んだ候補");
    for (const lead of readyLeads) {
      summaryLines.push(`- ${lead.channelName} / ${lead.email}`);
    }
  }

  if (unresolved.length) {
    summaryLines.push("");
    summaryLines.push("## 未解決候補");
    for (const lead of unresolved) {
      summaryLines.push(`- ${lead.channelName} / site: ${lead.siteUrl}`);
      summaryLines.push(`  ログ: ${lead.logs.join(" | ")}`);
      appendDiscoveryLog([
        `[${new Date().toISOString()}] ${lead.channelName}`,
        `site=${lead.siteUrl}`,
        ...lead.logs,
      ]);
    }
  }

  writeSummary(summaryLines.join("\n"));

  const quotaSummary = getYoutubeQuotaUsageSummary();
  console.log(`YOUTUBE_ATTEMPTED_UNITS=${quotaSummary.estimatedAttemptedUnits}`);
  console.log(`YOUTUBE_SUCCESSFUL_UNITS=${quotaSummary.estimatedSuccessfulUnits}`);
  console.log(`YOUTUBE_REMAINING_ESTIMATE=${quotaSummary.estimatedRemainingUnits}`);
  console.log(`YOUTUBE_BY_REQUEST=${JSON.stringify(quotaSummary.byRequestType)}`);
  console.log(`YOUTUBE_BY_KEY=${JSON.stringify(quotaSummary.byKeyLabel)}`);

  console.log(`BACKFILLED=${backfilledRows.length}`);
  console.log(`START_ROW=${startRow}`);
  console.log(`WRITTEN=${readyLeads.length}`);
  console.log(`UNRESOLVED=${unresolved.length}`);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
