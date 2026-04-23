/**
 * youtube.mjs — YouTube Data API v3 ラッパー
 *
 * https://developers.google.com/youtube/v3/docs
 *
 * 用途:
 *   - キーワード検索で動画を取得
 *   - 動画の詳細統計(再生数・高評価数・コメント数)を取得
 *   - チャンネル情報の取得
 *
 * 使い方:
 *   import { searchYouTubeBulk } from "./lib/youtube.mjs";
 *   const videos = await searchYouTubeBulk("Claude Code", { maxResults: 20 });
 *   // videos は [{ videoId, title, url, channel, channelUrl, publishedAt,
 *   //             viewCount, likeCount, commentCount, description, thumbnail }]
 *
 * 必須 .env:
 *   YOUTUBE_API_KEY(既存の GOOGLE_PLACES_API_KEY と同じキーでも動くが、別管理推奨)
 *
 * 料金:
 *   - 無料(クレジットカード登録不要)
 *   - 1日 10,000 ユニットの無料枠
 *   - search.list = 100 ユニット/req、videos.list = 1 ユニット/req(最大50件batch可)
 *   - 動画20件の一回リサーチ ≒ 101 ユニット(search + videos batch 1回)
 */

import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { registerApi, trackRequest } from "./usage.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "..", ".env") });

const SEARCH_ENDPOINT = "https://www.googleapis.com/youtube/v3/search";
const VIDEOS_ENDPOINT = "https://www.googleapis.com/youtube/v3/videos";
const MIN_INTERVAL_MS = 300;

let lastRequestTime = 0;

registerApi("youtube", {
  label: "YouTube Data API v3",
  priceModel: "free-tier-quota",
  currency: "USD",
  freeTier: {
    description: "1日 10,000 ユニット無料(search=100 units/req, videos=1 unit/req)",
    limit: 10000,
    limitUsd: null,
  },
  dashboardUrl: "https://console.cloud.google.com/apis/dashboard",
  note: "1日の無料枠のみ。超過すると翌日までリクエスト不可(申請で拡張可能)",
});

function getApiKey() {
  const key = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    throw new Error(
      "YOUTUBE_API_KEY が .env に未設定です。Google Cloud Console で YouTube Data API v3 を有効化し、APIキーを設定してください。"
    );
  }
  return key;
}

async function waitForRateLimit() {
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

/**
 * 動画検索(1ページ分)
 *
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.maxResults] - 1〜50(デフォ 25)
 * @param {string} [options.pageToken]
 * @param {string} [options.regionCode]  - "JP"(デフォ)
 * @param {string} [options.relevanceLanguage] - "ja" 等
 * @param {string} [options.order] - "relevance"(デフォ) / "date" / "viewCount" / "rating"
 * @param {string} [options.publishedAfter] - ISO 8601 形式
 * @param {string} [options.publishedBefore] - ISO 8601 形式
 * @param {"video"|"channel"|"playlist"} [options.type] - デフォ "video"
 * @returns {Promise<{ items: Array<object>, nextPageToken: string|null, raw: object }>}
 */
export async function searchYouTube(query, options = {}) {
  const apiKey = getApiKey();
  const {
    maxResults = 25,
    pageToken,
    regionCode = "JP",
    relevanceLanguage = "ja",
    order = "relevance",
    publishedAfter,
    publishedBefore,
    type = "video",
  } = options;

  await waitForRateLimit();

  const params = new URLSearchParams({
    part: "snippet",
    q: query,
    maxResults: String(Math.min(Math.max(maxResults, 1), 50)),
    type,
    regionCode,
    relevanceLanguage,
    order,
    key: apiKey,
  });
  if (pageToken) params.set("pageToken", pageToken);
  if (publishedAfter) params.set("publishedAfter", publishedAfter);
  if (publishedBefore) params.set("publishedBefore", publishedBefore);

  const res = await fetch(`${SEARCH_ENDPOINT}?${params.toString()}`);
  trackRequest("youtube");

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 403) {
      throw new Error(
        `YouTube Data API 認証/クォータエラー(403): APIキー・有効化状態・1日のクォータを確認してください。\n${body.slice(0, 300)}`
      );
    }
    throw new Error(`YouTube Data API エラー ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const items = (data.items || []).map(normalizeSearchItem);
  return { items, nextPageToken: data.nextPageToken || null, raw: data };
}

/**
 * 動画統計(viewCount / likeCount / commentCount など)を取得
 * 最大50件まで1リクエストでバッチ取得可能。
 *
 * @param {string[]} videoIds
 * @returns {Promise<Map<string, { viewCount: number, likeCount: number, commentCount: number, duration: string }>>}
 */
export async function getVideoStats(videoIds) {
  if (!videoIds.length) return new Map();
  const apiKey = getApiKey();
  const chunks = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    chunks.push(videoIds.slice(i, i + 50));
  }
  const out = new Map();
  for (const chunk of chunks) {
    await waitForRateLimit();
    const params = new URLSearchParams({
      part: "statistics,contentDetails",
      id: chunk.join(","),
      key: apiKey,
    });
    const res = await fetch(`${VIDEOS_ENDPOINT}?${params.toString()}`);
    trackRequest("youtube");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`YouTube videos.list エラー ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    for (const item of data.items || []) {
      out.set(item.id, {
        viewCount: Number(item.statistics?.viewCount || 0),
        likeCount: Number(item.statistics?.likeCount || 0),
        commentCount: Number(item.statistics?.commentCount || 0),
        duration: item.contentDetails?.duration || "",
      });
    }
  }
  return out;
}

/**
 * 検索結果をまとめて取得し、統計も付与したフラットな配列を返す。
 *
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.maxResults] - 取得上限(デフォ 25、上限は API 仕様に従う)
 * @param {boolean} [options.withStats] - true なら各動画の再生数等も取得(デフォ true)
 * @returns {Promise<Array<object>>}
 */
export async function searchYouTubeBulk(query, options = {}) {
  const { maxResults = 25, withStats = true, ...rest } = options;
  const all = [];
  let pageToken;
  while (all.length < maxResults) {
    const remaining = maxResults - all.length;
    const { items, nextPageToken } = await searchYouTube(query, {
      ...rest,
      maxResults: Math.min(remaining, 50),
      pageToken,
    });
    if (items.length === 0) break;
    all.push(...items);
    if (!nextPageToken) break;
    pageToken = nextPageToken;
  }
  const sliced = all.slice(0, maxResults);
  if (!withStats || sliced.length === 0) return sliced;

  const ids = sliced.map((i) => i.videoId).filter(Boolean);
  const statsMap = await getVideoStats(ids);
  for (const item of sliced) {
    const s = statsMap.get(item.videoId);
    if (s) Object.assign(item, s);
  }
  return sliced;
}

/**
 * search.list のレスポンスを扱いやすい平坦な形に変換
 */
function normalizeSearchItem(item) {
  const videoId = item.id?.videoId || "";
  const channelId = item.snippet?.channelId || "";
  const thumbs = item.snippet?.thumbnails || {};
  const thumbnail =
    thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || "";
  return {
    videoId,
    title: item.snippet?.title || "",
    url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
    description: item.snippet?.description || "",
    channel: item.snippet?.channelTitle || "",
    channelId,
    channelUrl: channelId ? `https://www.youtube.com/channel/${channelId}` : "",
    publishedAt: item.snippet?.publishedAt || "",
    thumbnail,
    viewCount: null,
    likeCount: null,
    commentCount: null,
    duration: "",
  };
}
