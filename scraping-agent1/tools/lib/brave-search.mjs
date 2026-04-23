/**
 * brave-search.mjs — Brave Search API ラッパー
 *
 * https://api.search.brave.com/app/documentation
 * 無料プラン: 2000クエリ/月、1 qps
 *
 * 使い方:
 *   import { searchWeb } from "./lib/brave-search.mjs";
 *   const results = await searchWeb("東京 居酒屋 ホームページ", { count: 20 });
 *
 *   results は [{ title, url, description }] の配列
 *
 * 必須 .env:
 *   BRAVE_SEARCH_API_KEY
 */

import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { sleep } from "./throttle.mjs";
import { registerApi, trackRequest } from "./usage.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "..", ".env") });

const API_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const MIN_INTERVAL_MS = 1100; // 1 qps 制限 + マージン

// ------------------------------------------------------------
// 料金情報の登録(usage.mjs 経由で集計される)
// ------------------------------------------------------------
// Free プラン: 月 2,000 クエリ無料、1 qps 制限。超過時は有料プランへの切り替えが必要。
registerApi("brave-search", {
  label: "Brave Search API",
  priceModel: "free-tier-quota",
  currency: "USD",
  freeTier: {
    description: "Free プラン: 月 2,000 クエリ無料",
    limit: 2000,
    limitUsd: null,
  },
  dashboardUrl: "https://api.search.brave.com/app/dashboard",
  note: "超過時は有料プラン($5/月〜)への切り替えが必要",
});

let lastRequestTime = 0;

/**
 * Brave Web Search を実行
 *
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.count] - 1〜20 (デフォ20)
 * @param {number} [options.offset] - ページネーション用(0〜9)
 * @param {string} [options.country] - "jp" 等(デフォ "jp")
 * @param {string} [options.searchLang] - "jp" 等(デフォ "jp")
 * @param {string} [options.uiLang] - "ja-JP" 等
 * @param {boolean} [options.safeSearch] - デフォ true(moderate)
 * @param {string} [options.freshness] - "pd" (past day) / "pw" / "pm" / "py"
 * @returns {Promise<Array<{ title: string, url: string, description: string, age?: string }>>}
 */
export async function searchWeb(query, options = {}) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    throw new Error(
      "BRAVE_SEARCH_API_KEY が .env に未設定です。https://brave.com/search/api/ でキーを取得してください"
    );
  }

  const {
    count = 20,
    offset = 0,
    country = "jp",
    searchLang = "jp",
    uiLang = "ja-JP",
    safeSearch = true,
    freshness,
  } = options;

  await waitForRateLimit();

  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(Math.max(count, 1), 20)),
    offset: String(offset),
    country,
    search_lang: searchLang,
    ui_lang: uiLang,
    safesearch: safeSearch ? "moderate" : "off",
  });
  if (freshness) params.set("freshness", freshness);

  const url = `${API_ENDPOINT}?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });

  // 無料枠消費のためレスポンスのステータスに関わらずカウント
  trackRequest("brave-search");

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Brave Search API 認証エラー(${res.status}): APIキーを確認してください`);
    }
    if (res.status === 429) {
      throw new Error("Brave Search API のレート制限に達しました(無料: 1 qps / 2000/月)");
    }
    throw new Error(`Brave Search API エラー ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  const results = (json.web && json.web.results) || [];

  return results.map((r) => ({
    title: r.title || "",
    url: r.url || "",
    description: r.description || "",
    age: r.age || null,
    language: r.language || null,
  }));
}

/**
 * 複数ページ分まとめて取得する(ページネーション自動)
 *
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.maxResults] - 取得上限件数(デフォ 50)
 * @param {number} [options.perPage] - 1ページあたりの件数(デフォ 20)
 */
export async function searchWebBulk(query, options = {}) {
  const { maxResults = 50, perPage = 20, ...rest } = options;
  const all = [];
  let offset = 0;
  // Brave API の offset は 0〜9 までなので、最大で 10 ページ分
  while (all.length < maxResults && offset < 10) {
    const batch = await searchWeb(query, {
      ...rest,
      count: perPage,
      offset,
    });
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < perPage) break;
    offset++;
  }
  return all.slice(0, maxResults);
}

async function waitForRateLimit() {
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await sleep(MIN_INTERVAL_MS - elapsed);
  }
  lastRequestTime = Date.now();
}
