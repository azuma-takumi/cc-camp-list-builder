/**
 * google-places.mjs — Google Places API (New) ラッパー
 *
 * https://developers.google.com/maps/documentation/places/web-service/overview
 *
 * Web スクレイピングで公開されていない電話番号・住所・営業時間を、Google が公式に
 * 持っているデータから API で取得する。店舗型ビジネス(飲食・美容・小売・医療等)に
 * 圧倒的に強い。
 *
 * 使い方:
 *   import { searchPlacesTextBulk } from "./lib/google-places.mjs";
 *   const places = await searchPlacesTextBulk("新宿区 居酒屋", { maxResults: 50 });
 *
 *   places は [{ name, address, phone, website, rating, userRatingCount, hours, mapsUrl, ... }] の配列
 *
 * 必須 .env:
 *   GOOGLE_PLACES_API_KEY
 *
 * 料金(2026年4月時点、目安):
 *   - 月 $200 の Google Maps Platform 無料クレジット(Cloud Billing で有効)
 *   - Text Search (Pro/Enterprise tier / Contact データ含む): おおよそ $20〜30/1000 リクエスト
 *   - 電話番号 / websiteUri は Advanced(Contact データ)SKU に該当し、他より少し高め
 *   - 詳細は https://mapsplatform.google.com/pricing/ を参照
 */

import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { sleep } from "./throttle.mjs";
import { registerApi, trackRequest } from "./usage.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "..", ".env") });

const API_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const MIN_INTERVAL_MS = 200; // ゆるめの間隔(Places は並列可能だが、礼儀として)

// ------------------------------------------------------------
// 料金情報の登録(usage.mjs 経由で集計される)
// ------------------------------------------------------------
// Text Search Advanced SKU(Contact データを含む)の目安: 約 $32/1000 requests。
// 電話番号・公式サイトを取る使い方だとこのレートに該当する。
// Maps Platform の月 $200 無料クレジット内なら実費は発生しない。
registerApi("google-places", {
  label: "Google Places API (New)",
  priceModel: "per-request",
  pricePerRequest: 0.032,
  currency: "USD",
  freeTier: {
    description: "Google Maps Platform 月 $200 無料クレジット(Cloud Billing 連携時)",
    limit: null,
    limitUsd: 200,
  },
  dashboardUrl: "https://console.cloud.google.com/billing",
  note: "単価は目安。正確な請求は Cloud Console の請求レポートで確認",
});
const DEFAULT_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.shortFormattedAddress",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.regularOpeningHours.weekdayDescriptions",
  "places.businessStatus",
  "places.types",
  "places.primaryTypeDisplayName",
  "places.location",
  "nextPageToken",
];

let lastRequestTime = 0;

/**
 * Places Text Search を1ページ分実行
 *
 * @param {string} query - 検索クエリ(例: "新宿区 居酒屋", "東京都 歯科医院")
 * @param {object} [options]
 * @param {number} [options.pageSize] - 1〜20(デフォ20)
 * @param {string} [options.pageToken] - 次ページ取得用のトークン
 * @param {string} [options.languageCode] - "ja"(デフォ)
 * @param {string} [options.regionCode] - "jp"(デフォ)
 * @param {string[]} [options.fields] - 取得フィールドのFieldMask配列
 * @param {boolean} [options.openNow] - 「今営業中」でフィルタ
 * @param {number} [options.minRating] - 最低評価(1.0〜5.0)
 * @param {{latitude:number,longitude:number,radius:number}} [options.locationBias]
 *        位置ベースのバイアス(半径メートル指定)
 * @returns {Promise<{ places: Array<object>, nextPageToken: string|null, raw: object }>}
 */
export async function searchPlacesText(query, options = {}) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_PLACES_API_KEY が .env に未設定です。Google Cloud Console で Places API (New) を有効化し、API キーを発行してください。"
    );
  }

  const {
    pageSize = 20,
    pageToken,
    languageCode = "ja",
    regionCode = "jp",
    fields = DEFAULT_FIELDS,
    openNow,
    minRating,
    locationBias,
  } = options;

  await waitForRateLimit();

  const body = {
    textQuery: query,
    pageSize: Math.min(Math.max(pageSize, 1), 20),
    languageCode,
    regionCode,
  };
  if (pageToken) body.pageToken = pageToken;
  if (typeof openNow === "boolean") body.openNow = openNow;
  if (typeof minRating === "number") body.minRating = minRating;
  if (locationBias?.latitude && locationBias?.longitude) {
    body.locationBias = {
      circle: {
        center: {
          latitude: locationBias.latitude,
          longitude: locationBias.longitude,
        },
        radius: locationBias.radius || 5000,
      },
    };
  }

  const res = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fields.join(","),
    },
    body: JSON.stringify(body),
  });

  // HTTP エラー応答でも API 呼び出しは課金されることがあるため、ステータスに関わらずカウント
  trackRequest("google-places");

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Google Places API 認証/権限エラー(${res.status}): APIキー・Places API (New) の有効化・請求先の設定を確認してください。\n${errorBody.slice(0, 300)}`
      );
    }
    if (res.status === 429) {
      throw new Error(
        "Google Places API のレート制限に達しました。しばらく待つか、Cloud Billing のクォータを確認してください。"
      );
    }
    throw new Error(
      `Google Places API エラー ${res.status}: ${errorBody.slice(0, 300)}`
    );
  }

  const json = await res.json();
  const places = (json.places || []).map(normalizePlace);
  return {
    places,
    nextPageToken: json.nextPageToken || null,
    raw: json,
  };
}

/**
 * 複数ページ分まとめて取得(nextPageToken で自動追加)
 *
 * Places API (New) の Text Search は nextPageToken で最大3ページ(計60件)まで取れる。
 *
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.maxResults] - 取得上限件数(デフォ 60、上限60)
 * @param {number} [options.perPage] - 1ページあたり(デフォ20、上限20)
 */
export async function searchPlacesTextBulk(query, options = {}) {
  const { maxResults = 60, perPage = 20, ...rest } = options;
  const all = [];
  let pageToken;
  let pagesFetched = 0;
  const maxPages = 3; // API の上限

  while (all.length < maxResults && pagesFetched < maxPages) {
    const { places, nextPageToken } = await searchPlacesText(query, {
      ...rest,
      pageSize: perPage,
      pageToken,
    });
    if (places.length === 0) break;
    all.push(...places);
    pagesFetched++;
    if (!nextPageToken) break;
    pageToken = nextPageToken;
    // Google は nextPageToken が有効になるまで2秒ほど時間が必要
    await sleep(2000);
  }
  return all.slice(0, maxResults);
}

/**
 * API のレスポンスを人間可読 & シート向けに正規化
 */
function normalizePlace(p) {
  return {
    id: p.id,
    name: p.displayName?.text || "",
    address: p.formattedAddress || "",
    shortAddress: p.shortFormattedAddress || "",
    phone: p.nationalPhoneNumber || "",
    phoneInternational: p.internationalPhoneNumber || "",
    website: p.websiteUri || "",
    mapsUrl: p.googleMapsUri || "",
    rating: typeof p.rating === "number" ? p.rating : null,
    userRatingCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    priceLevel: p.priceLevel || null,
    hours: p.regularOpeningHours?.weekdayDescriptions?.join(" / ") || "",
    businessStatus: p.businessStatus || "",
    types: (p.types || []).join(", "),
    primaryType: p.primaryTypeDisplayName?.text || "",
    latitude: p.location?.latitude || null,
    longitude: p.location?.longitude || null,
  };
}

async function waitForRateLimit() {
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await sleep(MIN_INTERVAL_MS - elapsed);
  }
  lastRequestTime = Date.now();
}
