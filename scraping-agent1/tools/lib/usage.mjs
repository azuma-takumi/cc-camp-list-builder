/**
 * usage.mjs — API 使用量トラッカー
 *
 * 各 API コネクタがモジュールロード時に `registerApi()` で自分の料金情報を登録し、
 * API 呼び出しの直後に `trackRequest()` でリクエスト数をカウントする。
 *
 * リサーチ終了時、research.mjs が `buildUsageReport()` でサマリを取得して返す。
 *
 * - セッション集計: 現在進行中のリサーチ1回分のリクエスト数 + 推定費用
 * - 月次集計: `.usage.json` に永続化、月替わりで自動リセット
 * - 円換算: `.env` の `USD_JPY_RATE`(未指定なら 150 円/USD)
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");
dotenv.config({ path: join(PROJECT_ROOT, ".env") });

const USAGE_FILE = join(PROJECT_ROOT, ".usage.json");
const USD_JPY_RATE = parseFloat(process.env.USD_JPY_RATE || "150");

/** @type {Map<string, ApiPricingMeta>} */
const registry = new Map();

/** @type {Map<string, number>} 今セッションのリクエスト数 */
let sessionCounts = new Map();

/**
 * @typedef {Object} ApiPricingMeta
 * @property {string} label - 表示名("Google Places API (New)")
 * @property {"per-request"|"free-tier-quota"|"free"} priceModel
 * @property {number} [pricePerRequest] - USD(per-request 時)
 * @property {string} [currency]
 * @property {Object} [freeTier]
 * @property {string} [freeTier.description]
 * @property {number|null} [freeTier.limit]     - リクエスト数上限(free-tier-quota 用)
 * @property {number|null} [freeTier.limitUsd]  - 金額クレジット(Google Cloud 等)
 * @property {string} [dashboardUrl]            - 実請求確認先
 * @property {string} [note]                    - 備考メッセージ
 */

/**
 * コネクタが自分の料金情報を登録する(モジュールロード時に呼ぶ)。
 * 冪等: 同じ name で複数回呼ばれても最後の値で上書き。
 * @param {string} name
 * @param {ApiPricingMeta} pricingMeta
 */
export function registerApi(name, pricingMeta) {
  registry.set(name, { currency: "USD", ...pricingMeta });
}

/**
 * 1リクエスト分カウント(API を叩いた直後、エラー判定の前に呼ぶ)。
 * HTTP エラー応答でも API 呼び出しは課金対象になる場合があるため、
 * あえて応答ステータスに関わらずカウントする。
 * @param {string} name
 */
export function trackRequest(name) {
  if (!registry.has(name)) {
    if (process.env.DEBUG) {
      console.warn(`[usage] 未登録 API にリクエストがカウントされました: ${name}`);
    }
    return;
  }
  sessionCounts.set(name, (sessionCounts.get(name) || 0) + 1);

  const state = loadUsageState();
  state.usage[name] = (state.usage[name] || 0) + 1;
  state.updatedAt = new Date().toISOString();
  saveUsageState(state);
}

/**
 * 新しいセッションを開始(runResearch 実行時に呼ぶ)。
 */
export function startSession() {
  sessionCounts = new Map();
}

export function getSessionCounts() {
  return new Map(sessionCounts);
}

export function getMonthlyCounts() {
  const state = loadUsageState();
  return new Map(Object.entries(state.usage));
}

/**
 * レポート用データを構築。
 * @returns {{ session: Array<ReportEntry>, monthly: Array<ReportEntry>, rate: number, month: string }}
 */
export function buildUsageReport() {
  const session = buildReportFromCounts(getSessionCounts());
  const monthly = buildReportFromCounts(getMonthlyCounts());
  return {
    session,
    monthly,
    rate: USD_JPY_RATE,
    month: loadUsageState().month,
  };
}

function buildReportFromCounts(counts) {
  const entries = [];
  for (const [name, meta] of registry) {
    const requests = counts.get(name) || 0;
    if (requests === 0) continue;

    let costUsd = 0;
    let overLimit = false;
    let status = "ok";

    if (meta.priceModel === "per-request") {
      costUsd = requests * (meta.pricePerRequest || 0);
      if (meta.freeTier?.limitUsd && costUsd > meta.freeTier.limitUsd) {
        overLimit = true;
        status = "over-free-credit";
      } else if (meta.freeTier?.limitUsd) {
        status = "within-free-credit";
      }
    } else if (meta.priceModel === "free-tier-quota") {
      const limit = meta.freeTier?.limit;
      if (limit && requests > limit) {
        overLimit = true;
        status = "over-free-quota";
      } else if (limit) {
        status = "within-free-quota";
      }
      costUsd = 0;
    } else if (meta.priceModel === "free") {
      costUsd = 0;
      status = "free";
    }

    entries.push({
      name,
      label: meta.label,
      requests,
      costUsd,
      costJpy: costUsd * USD_JPY_RATE,
      priceModel: meta.priceModel,
      pricePerRequest: meta.pricePerRequest || null,
      freeTierLimit: meta.freeTier?.limit || null,
      freeTierLimitUsd: meta.freeTier?.limitUsd || null,
      freeTierNote: meta.freeTier?.description || null,
      dashboardUrl: meta.dashboardUrl || null,
      overLimit,
      status,
      note: meta.note || null,
    });
  }
  return entries;
}

/**
 * レポートをチャット表示向けマークダウンに整形。
 * research.mjs の結果報告に含まれる想定。
 */
export function formatUsageReportMarkdown(report) {
  const { session, monthly, rate, month } = report;
  const lines = [];

  lines.push("💰 今回のリサーチで使った API");
  lines.push("");
  if (session.length === 0) {
    lines.push("- 有料 API の使用なし");
  } else {
    lines.push("| API | リクエスト | 推定費用 | 備考 |");
    lines.push("|---|---|---|---|");
    for (const e of session) {
      lines.push(`| ${e.label} | ${e.requests} req | ${formatCost(e)} | ${formatNote(e)} |`);
    }
  }

  lines.push("");
  lines.push(`ℹ️ 今月(${month})の累計 — このプロジェクトで記録`);
  lines.push("");
  if (monthly.length === 0) {
    lines.push("- (今月はまだ API 使用なし)");
  } else {
    lines.push("| API | リクエスト | 推定費用 | 備考 |");
    lines.push("|---|---|---|---|");
    for (const e of monthly) {
      lines.push(`| ${e.label} | ${e.requests} req | ${formatCost(e)} | ${formatNote(e)} |`);
    }
  }

  const dashboards = [
    ...new Set(
      [...session, ...monthly].map((e) => e.dashboardUrl).filter(Boolean)
    ),
  ];
  if (dashboards.length > 0) {
    lines.push("");
    lines.push("実請求はこちらで確認できます:");
    for (const url of dashboards) {
      lines.push(`- ${url}`);
    }
  }

  lines.push("");
  lines.push(
    `※ USD→JPY 換算は ${rate} 円/USD(\`.env\` の \`USD_JPY_RATE\` で変更可)。` +
      `推定費用は目安で、実請求はダッシュボードで確認してください。`
  );

  return lines.join("\n");
}

function formatCost(e) {
  if (e.priceModel === "per-request") {
    const usd = e.costUsd.toFixed(3);
    const jpy = Math.round(e.costJpy);
    return `$${usd}(約 ${jpy}円)`;
  }
  if (e.priceModel === "free-tier-quota") {
    if (e.freeTierLimit) {
      const used = e.requests;
      const remain = Math.max(0, e.freeTierLimit - used);
      if (e.overLimit) {
        return `⚠️ 無料枠超過(${used} / ${e.freeTierLimit})`;
      }
      return `無料(${used} / ${e.freeTierLimit}、残り ${remain})`;
    }
    return "無料";
  }
  if (e.priceModel === "free") return "無料";
  return "—";
}

function formatNote(e) {
  const parts = [];
  if (e.status === "within-free-credit" && e.freeTierLimitUsd) {
    parts.push(`月 $${e.freeTierLimitUsd} 無料クレジット内`);
  }
  if (e.status === "over-free-credit" && e.freeTierLimitUsd) {
    parts.push(`⚠️ 月 $${e.freeTierLimitUsd} 無料クレジットを超えている可能性`);
  }
  if (e.status === "over-free-quota") {
    parts.push("⚠️ 月次無料枠超過");
  }
  if (e.note) parts.push(e.note);
  return parts.join(" / ") || "—";
}

// ------------------------------------------------------------
// 永続化(月次): .usage.json
// ------------------------------------------------------------

function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function loadUsageState() {
  const month = currentMonthKey();
  const fallback = {
    version: 1,
    month,
    usage: {},
    updatedAt: new Date().toISOString(),
  };

  if (!existsSync(USAGE_FILE)) return fallback;

  try {
    const parsed = JSON.parse(readFileSync(USAGE_FILE, "utf-8"));
    if (parsed.month !== month) {
      // 月替わりで自動リセット
      return fallback;
    }
    return {
      version: parsed.version || 1,
      month,
      usage: parsed.usage || {},
      updatedAt: parsed.updatedAt || fallback.updatedAt,
    };
  } catch {
    return fallback;
  }
}

function saveUsageState(state) {
  try {
    writeFileSync(USAGE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    if (process.env.DEBUG) console.warn(`[usage] 永続化失敗: ${err.message}`);
  }
}

export { USAGE_FILE, USD_JPY_RATE };
