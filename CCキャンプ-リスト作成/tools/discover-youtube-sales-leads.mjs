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
import { searchGoogleWeb } from "./lib/google-search-api.mjs";
import { searchBraveWeb } from "./lib/brave-search-api.mjs";
import { appendDatedLog, writeStandardSummary } from "./lib/summary-writer.mjs";

const SPREADSHEET_ID = "1E7sL6TjDiGWUF77uMAc88XK7OzXXS8wgDgwInI5Ad1c";
const ORIGINAL_SPREADSHEET_ID = "1WG00opfjyNsUO6Apr-IEbH1KxmDlYyaGjPoV6LDnJd0";
const SHEET_NAME = "スポーツ用品業界：メールアドレス";
const WRITER_NAME = "東たくみ";
const TARGET_WRITE_COUNT = Number(process.env.TARGET_WRITE_COUNT || "30");
const ENABLE_BACKFILL = false;
const QUERY_LIMIT = Number(process.env.QUERY_LIMIT || "30");
const QUERY_RESULTS_LIMIT = Number(process.env.QUERY_RESULTS_LIMIT || "10");
const MAX_CANDIDATES = Number(process.env.MAX_CANDIDATES || "200");
const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, "..", "logs");

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
  // 地域 × ジャンル
  "北海道 スポーツ用品店 公式",
  "東北 スポーツ用品店 公式",
  "北関東 スポーツ用品店 公式",
  "東海 スポーツ用品店 公式",
  "関西 スポーツ用品店 公式",
  "中国 四国 スポーツ用品店 公式",
  "九州 スポーツ用品店 公式",
  "沖縄 スポーツ用品 公式",
  // ニッチスポーツ用品
  "アーチェリー 弓具店 公式",
  "フェンシング 用具 販売 公式",
  "ボクシング グローブ 販売 公式",
  "レスリング 柔術 用品店 公式",
  "ウエイトリフティング 用品 公式",
  "トライアスロン 用品店 公式",
  "カヌー カヤック 用品 公式",
  "ロッククライミング 用品店 公式",
  "スケートボード 用品店 公式",
  "ラクロス フィールドホッケー 用品 公式",
  "ソフトボール 用品店 公式",
  "パドルテニス ピックルボール 用品 公式",
  // 用品系メーカー特化
  "スポーツ消耗品 用品メーカー 公式",
  "野球グローブ メーカー 公式チャンネル",
  "ゴルフシャフト メーカー 公式",
  "テニスガット メーカー 公式",
  "スポーツテーピング サポーター メーカー 公式",
  "トレーニングウェア メーカー 公式チャンネル",
  "スポーツ栄養 プロテイン メーカー 公式",
  "スポーツ用品 卸売 メーカー 公式",
  "学校体育 用品 メーカー 公式",
  "スポーツ安全用具 プロテクター 販売 公式",
  // ── 追加ニッチクエリ ──
  // 種目専門店
  "剣道 防具 道着 専門店 公式",
  "弓道 弓具 矢 専門店 公式",
  "空手 道着 防具 専門店 公式",
  "合気道 柔道 武道 用品店 公式",
  "相撲 まわし 行司 用品 公式",
  "馬術 乗馬 馬具 用品店 公式",
  "自転車 サイクル 用品店 公式",
  "スノーボード スキー 用品店 公式",
  "サーフィン ウィンドサーフィン 用品店 公式",
  "マリンスポーツ ダイビング 用品店 公式",
  "ハンドボール バレーボール 専門店 公式",
  "バドミントン 専門店 用品 公式",
  "卓球 専門店 ラケット 公式",
  "水泳 競泳 水着 専門店 公式",
  "陸上 短距離 マラソン シューズ 専門店",
  "バスケットボール 専門店 公式チャンネル",
  "ラグビー アメフト 用品店 公式",
  "アウトドア スポーツ 用品店 公式",
  "格闘技 MMA 用品 販売 公式",
  "ヨット セーリング 用品 公式",
  // ブランド・メーカー系
  "スポーツ用品 オリジナル ブランド 公式",
  "スポーツ アパレル ウェア 国内 メーカー 公式",
  "スポーツ シューズ 専門 メーカー 公式",
  "スポーツ バッグ ケース メーカー 公式",
  "球技 ボール 製造 メーカー 公式",
  // 地域特化
  "北陸 石川 富山 スポーツ用品 公式",
  "信越 長野 新潟 スポーツ用品 公式",
  "山陰 鳥取 島根 スポーツ用品 公式",
  "南九州 熊本 鹿児島 スポーツ用品 公式",
  "関東 埼玉 千葉 スポーツ用品店 公式",
  "関西 京都 奈良 スポーツ用品店 公式",
  // 学校・チーム向け
  "学校 部活動 スポーツ 用品 公式",
  "チーム ユニフォーム オーダー スポーツ 公式",
  "スポーツ チームウェア 制作 公式",
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

function appendDiscoveryLog(lines) {
  appendDatedLog({ logDir: LOG_DIR, prefix: "lead-discovery", lines });
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

const PERSONAL_EMAIL_DOMAINS = /^(gmail|yahoo|hotmail|outlook|icloud|me|live|msn|googlemail)\./i;
// チャンネル名・会社名に含まれるべきスポーツ用品系キーワード
const SPORTS_GOODS_KEYWORDS = /スポーツ用品|sport.*goods|用品|スポーツ|sport|アウトドア|outdoor|フィットネス|fitness|ゴルフ|golf|野球|テニス|サッカー|バスケ|バドミントン|卓球|剣道|弓道|柔道|空手|格闘技|武道|登山|ハイキング|サーフィン|スキー|スノーボード|自転車|サイクル|ランニング|マラソン|水泳|競泳|ウェットスーツ|グローブ|ラケット/i;
// 除外業界（クライアント指定）
const EXCLUDED_INDUSTRIES = /ボウリング|bowling|釣り|fishing|つり|フィッシング/i;

function looksLikeSportsEquipmentChannel(channelName, companyName, email) {
  // チャンネル名のみでスポーツ用品キーワードを判定（会社名は検索結果由来のノイズが多いため除外）
  const hasSportsKeyword = SPORTS_GOODS_KEYWORDS.test(channelName);
  const hasLegalEntity = /株式会社|有限会社|合同会社|一般社団法人|公益社団法人/.test(companyName || "");
  const isCompanyEmail = email ? !PERSONAL_EMAIL_DOMAINS.test((email.split("@")[1] || "")) : false;

  // チャンネル名にスポーツ用品キーワードは必須
  if (!hasSportsKeyword) return false;
  // 法人名あり または 会社ドメインメール → OK
  return hasLegalEntity || isCompanyEmail;
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

  // 書き込み先：コピーシート
  saveSpreadsheetId(SPREADSHEET_ID);
  const rows = await readSheetValues(SHEET_NAME, "A:K");
  const headerRowIndex = findHeaderRow(rows);
  if (headerRowIndex === -1) {
    throw new Error("ヘッダー行が見つかりませんでした");
  }

  const backfilledRows = ENABLE_BACKFILL ? await backfillExistingMetadata(rows, headerRowIndex) : [];
  const startRow = findStartRow(rows, headerRowIndex);

  // 重複チェック：オリジナルシートから既存チャンネル名・メールを取得
  saveSpreadsheetId(ORIGINAL_SPREADSHEET_ID);
  const originalRows = await readSheetValues(SHEET_NAME, "A:G");
  const originalHeaderIdx = findHeaderRow(originalRows);
  const existingChannelNames = new Set([
    ...rows.slice(headerRowIndex + 1).map((row) => String(row[2] || "").trim()).filter(Boolean),
    ...(originalHeaderIdx >= 0
      ? originalRows.slice(originalHeaderIdx + 1).map((row) => String(row[2] || "").trim()).filter(Boolean)
      : []),
  ]);

  // 書き込みはコピーシートに戻す
  saveSpreadsheetId(SPREADSHEET_ID);
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

    if (EXCLUDED_INDUSTRIES.test(candidate.channelName)) {
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

    if (lead.email && looksLikeSportsEquipmentChannel(lead.channelName, lead.companyName, lead.email)) {
      // チャンネル登録者数・最終投稿日を取得
      const metrics = await getYoutubeChannelMetricsByUrl(lead.youtubeUrl);
      lead.subscriberCount = metrics?.subscriberCount || "";
      lead.latestVideoPublishedAt = metrics?.latestVideoPublishedAt || "";
      readyLeads.push(lead);
    } else if (lead.email) {
      unresolved.push({ ...lead, siteUrl: resolvedSiteUrl, logs: [...checkedYoutubeUrl.logs, ...contact.logs, "スキップ: スポーツ用品企業と判定できず"] });
    } else {
      unresolved.push({
        ...lead,
        siteUrl: resolvedSiteUrl,
        logs: [...checkedYoutubeUrl.logs, ...contact.logs],
      });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  // A列（No）は色付き書式で問題検知に使われているため書き込まない。B列(index=1)から開始。
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
  }

  const quotaSummary = getYoutubeQuotaUsageSummary();
  const sections = [];

  if (backfilledRows.length) {
    sections.push({
      heading: "補完した既存行",
      lines: backfilledRows.map(
        (row) => `- ${row.rowNumber}行目 ${row.channelName} / ${row.companyName || "-"} / ${row.representativeName || "-"}`
      ),
    });
  }

  if (readyLeads.length) {
    sections.push({
      heading: "書き込んだ候補",
      lines: readyLeads.map((lead) => `- ${lead.channelName} / ${lead.email}`),
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

    sections.push({
      heading: "未解決候補",
      lines: unresolvedLines,
    });
  }

  writeStandardSummary({
    logDir: LOG_DIR,
    fileName: "youtube-lead-discovery-summary.md",
    title: "YouTube営業リスト探索結果",
    overview: [
      { label: "既存空欄の補完", value: backfilledRows.length },
      { label: "開始行", value: startRow },
      { label: "候補数", value: candidates.length },
      { label: "追加目標件数", value: TARGET_WRITE_COUNT },
    ],
    metrics: [
      { label: "書き込み成功", value: readyLeads.length },
      { label: "メール未発見", value: unresolved.length },
      { label: "YouTube試行ユニット", value: quotaSummary.estimatedAttemptedUnits },
      { label: "YouTube成功ユニット", value: quotaSummary.estimatedSuccessfulUnits },
      { label: "YouTube残量推定", value: quotaSummary.estimatedRemainingUnits },
    ],
    sections,
  });

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
