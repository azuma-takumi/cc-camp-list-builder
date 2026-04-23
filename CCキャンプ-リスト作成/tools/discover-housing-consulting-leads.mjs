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

const SPREADSHEET_ID = "1x4__YI76LycSL_4DHxSrMTp2QSbbi7FXTRe3ikPN1ZE";
const ORIGINAL_SPREADSHEET_ID = "1kkN9EolMpGC7u6w1RCJoK38yZTev1nUo4CYqGi_yamM";
const SHEET_NAME = "住宅コンサルティング：メールアドレス";
const WRITER_NAME = "東たくみ";
const TARGET_WRITE_COUNT = Number(process.env.TARGET_WRITE_COUNT || "30");
const QUERY_LIMIT = Number(process.env.QUERY_LIMIT || "50");
const QUERY_RESULTS_LIMIT = Number(process.env.QUERY_RESULTS_LIMIT || "10");
const MAX_CANDIDATES = Number(process.env.MAX_CANDIDATES || "300");
const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, "..", "logs");

const SEARCH_QUERIES = [
  // 家づくり失敗・後悔系
  "家づくり 失敗しない 注文住宅 チャンネル",
  "家づくり 後悔しない 家 建てる チャンネル",
  "注文住宅 失敗例 後悔 解説 チャンネル",
  "マイホーム 後悔 失敗 体験談 チャンネル",
  "家建てた 後悔 欠陥住宅 チャンネル",
  // 住宅コンサルタント・アドバイザー
  "住宅コンサルタント 家づくり 相談 チャンネル",
  "住宅アドバイザー 家 建てる 相談 チャンネル",
  "ハウスメーカー 比較 選び方 アドバイス チャンネル",
  "住宅購入 コンサルタント 第三者 チャンネル",
  "家づくり 専門家 アドバイス チャンネル",
  // 建築士・設計士
  "建築士 家づくり 間取り チャンネル",
  "一級建築士 注文住宅 設計 チャンネル",
  "建築士 ハウスメーカー 比較 チャンネル",
  "建築士 家 購入 アドバイス チャンネル",
  "設計士 間取り 提案 チャンネル",
  // 間取り
  "間取り 診断 失敗しない チャンネル",
  "間取り 解説 注文住宅 チャンネル",
  "間取り プランニング 家づくり チャンネル",
  "理想の間取り 設計 チャンネル",
  "間取り 後悔 失敗 対策 チャンネル",
  // ハウスメーカー比較
  "ハウスメーカー 比較 おすすめ ランキング チャンネル",
  "ハウスメーカー 選び方 坪単価 チャンネル",
  "積水ハウス 住友林業 比較 チャンネル",
  "工務店 ハウスメーカー 違い 選び方 チャンネル",
  "地元工務店 注文住宅 チャンネル",
  // 住宅ローン
  "住宅ローン 選び方 固定金利 変動金利 チャンネル",
  "住宅ローン 審査 通し方 チャンネル",
  "住宅ローン 借り方 相談 チャンネル",
  "フラット35 住宅ローン 比較 チャンネル",
  "住宅ローン 完済 繰り上げ返済 チャンネル",
  // 土地探し
  "土地 探し方 注文住宅 チャンネル",
  "土地 選び方 失敗しない チャンネル",
  "旗竿地 変形地 土地 チャンネル",
  "土地 価格 交渉 購入 チャンネル",
  "土地 地盤 調査 チャンネル",
  // 中古住宅・リノベ
  "中古住宅 リノベーション 購入 チャンネル",
  "中古マンション リノベ 失敗しない チャンネル",
  "築古 リフォーム リノベ チャンネル",
  "中古一戸建て 購入 チャンネル",
  "空き家 リノベ 活用 チャンネル",
  // 省エネ・ZEH・高気密
  "高気密高断熱 住宅 チャンネル",
  "ZEH ゼロエネルギー住宅 チャンネル",
  "省エネ住宅 断熱 住宅 チャンネル",
  "パッシブハウス 断熱 設計 チャンネル",
  "耐震等級 地震に強い家 チャンネル",
  // 不動産・マンション
  "マンション購入 失敗しない チャンネル",
  "新築マンション 中古マンション 比較 チャンネル",
  "不動産 購入 アドバイス チャンネル",
  "マンション 管理費 修繕積立 チャンネル",
  "不動産 投資 住宅 チャンネル",
  // 家計・コスト
  "家づくり 予算 費用 コスト チャンネル",
  "注文住宅 坪単価 費用 相場 チャンネル",
  "家 建てる 総費用 内訳 チャンネル",
  "住宅 見積もり 値引き 交渉 チャンネル",
  "家 コストダウン 節約 チャンネル",
  // インテリア・設備
  "キッチン 水回り 住宅設備 選び方 チャンネル",
  "インテリア 家づくり コーディネート チャンネル",
  "収納 動線 間取り 整理収納 チャンネル",
  "外構 庭 エクステリア チャンネル",
  "太陽光発電 蓄電池 住宅 チャンネル",
  // 地域別
  "東京 注文住宅 家づくり チャンネル",
  "大阪 関西 家づくり 注文住宅 チャンネル",
  "名古屋 愛知 注文住宅 チャンネル",
  "福岡 九州 家づくり チャンネル",
  // その他住宅系
  "建売住宅 分譲住宅 比較 チャンネル",
  "二世帯住宅 失敗しない チャンネル",
  "平屋 注文住宅 設計 チャンネル",
  "狭小住宅 3階建て チャンネル",
  "住宅購入 不動産 エージェント チャンネル",
  // ── ニッチ・追加クエリ ──
  // 職業・専門家系
  "元ハウスメーカー社員 家づくり 暴露",
  "元住宅営業 真実 家 建てる",
  "不動産鑑定士 住宅 相談 チャンネル",
  "ホームインスペクター 住宅診断 チャンネル",
  "建築家 住宅設計 設計事務所 チャンネル",
  // 特定の建築スタイル
  "木造住宅 無垢材 自然素材 チャンネル",
  "鉄骨住宅 RC 構造 比較 チャンネル",
  "ログハウス 別荘 週末住宅 チャンネル",
  "コンテナハウス ガレージハウス チャンネル",
  "古民家 リノベ 移住 チャンネル",
  // 資金・補助金
  "住宅補助金 グリーン住宅ポイント 減税 チャンネル",
  "すまい給付金 住宅ローン控除 申請 チャンネル",
  "新築 補助金 ZEH補助 チャンネル",
  // 地方移住
  "地方移住 田舎暮らし 家 購入 チャンネル",
  "北海道 家づくり 寒冷地 チャンネル",
  "沖縄 家づくり 台風 住宅 チャンネル",
  "北陸 新潟 雪国 住宅 チャンネル",
  "四国 中国地方 家づくり チャンネル",
  // 住まいのトラブル・欠陥
  "欠陥住宅 被害 相談 チャンネル",
  "雨漏り シロアリ 住宅 被害 チャンネル",
  "施工不良 住宅 クレーム 対処 チャンネル",
  // 建築確認・法律
  "建築基準法 都市計画 住宅 チャンネル",
  "用途地域 建蔽率 容積率 住宅 チャンネル",
  // ライフスタイル系住宅
  "ペット共生 住宅 間取り チャンネル",
  "在宅ワーク テレワーク 書斎 間取り チャンネル",
  "趣味部屋 ガレージ バイク 住宅 チャンネル",
  "子育て 住まい 設計 チャンネル",
  "老後 バリアフリー 住宅 リフォーム チャンネル",
  // 実例・体験談
  "マイホーム 完成 引渡し 実例 チャンネル",
  "家 建てた 体験談 ブログ チャンネル",
  "注文住宅 完成 公開 ルームツアー チャンネル",
  // 住宅比較・検討
  "積水ハウス へーベルハウス 比較 チャンネル",
  "一条工務店 比較 住宅 チャンネル",
  "パナソニックホームズ 大和ハウス 比較 チャンネル",
  "タマホーム ヤマダホームズ ローコスト チャンネル",
  "地元 工務店 注文住宅 公式 チャンネル",
];

// 切り抜き系チャンネルの除外パターン
const CLIP_CHANNEL_PATTERN = /切り抜き|きりぬき|切抜き|clip channel/i;
// 海外チャンネルの除外パターン（英語のみタイトル）
const OVERSEAS_PATTERN = /^[a-zA-Z0-9\s\-_!?.,'"@#$%&*()[\]{}|/\\+=<>~`]+$/;

// 住宅と無関係と判明したチャンネルのブラックリスト（再収集時に再追加されるのを防ぐ）
const CHANNEL_BLACKLIST = new Set([
  "牛コンサルチャンネル",
  "赤沼慎太郎の経営改善・資金繰り・資金調達チャンネル",
  "ふくしまおうちチャンネルでは、【住まい工房やまぎし】のヤマさんが、新築建売住宅を語ります!",
  "カズの家づくりチャンネル【快適な住まい　理想の家づくり】",
  "オモコロチャンネル",
  "ガルシーちゃんねる",
  "千日太郎　公認会計士の住宅ローン専門チャンネル", // JICPAメール（本人でない）
  "ガルわんこ有益まとめ【仕事とお金の本音】",        // girlschannel系
]);

// サンプル・プレースホルダーメールの除外パターン
const SAMPLE_EMAIL_PATTERN = /^(mail@sample\.|sample@mail\.|sample@sapporo|test@|noreply@|no-reply@|example@)/i;

// メールドメインのブラックリスト（プラットフォーム系・無関係ドメイン）
const BLOCKED_EMAIL_DOMAINS = /girlschannel\.net|jicpa\.or\.jp/i;

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
  appendDatedLog({ logDir: LOG_DIR, prefix: "housing-consulting-discovery", lines });
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

function isValidHousingConsultingChannel(channelName, email = "") {
  if (CLIP_CHANNEL_PATTERN.test(channelName)) return false;
  // 完全に英数字のみ（海外チャンネル）は除外
  if (OVERSEAS_PATTERN.test(channelName)) return false;
  // ブラックリスト済みチャンネルは除外
  if (CHANNEL_BLACKLIST.has(channelName)) return false;
  // サンプル・プレースホルダーメールは除外
  if (email && SAMPLE_EMAIL_PATTERN.test(email)) return false;
  // ブロックドメインのメールは除外
  if (email && BLOCKED_EMAIL_DOMAINS.test(email.split("@")[1] || "")) return false;
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
    if (!isValidHousingConsultingChannel(candidate.channelName.trim(), candidate.emailFromYoutube)) continue;

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

    if (lead.email && !SAMPLE_EMAIL_PATTERN.test(lead.email) && !BLOCKED_EMAIL_DOMAINS.test(lead.email.split("@")[1] || "")) {
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
    const sheetsModule = await import('./lib/sheets.mjs');
    const getSheetsClient = sheetsModule.getSheetsClient;
    if (getSheetsClient) {
      const sheets = await getSheetsClient();
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
    fileName: "housing-consulting-lead-discovery-summary.md",
    title: "住宅コンサルティング業界リスト探索結果",
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
