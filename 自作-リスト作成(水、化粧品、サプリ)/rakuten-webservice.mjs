/**
 * 楽天ウェブサービス（Rakuten Ichiba Item Search API）
 * https://webservice.rakuten.co.jp/ でアプリ登録 → applicationId（必須）、accessKey（新規アプリは必須）
 *
 * 環境変数:
 * - RAKUTEN_APPLICATION_ID … アプリケーションID
 * - RAKUTEN_ACCESS_KEY … アクセスキー（新規アプリは必須が多い）
 * - RAKUTEN_AFFILIATE_ID … 任意。指定時はレスポンスにアフィリ用URLが付く
 * - RAKUTEN_APP_URL … 任意。登録アプリURLのメモ用（このモジュールでは未使用）
 * - RAKUTEN_GENRE_APP_URL / RAKUTEN_GENRE_ACCESS_KEY / RAKUTEN_GENRE_APPLICATION_ID / RAKUTEN_GENRE_AFFILIATE_ID … ジャンル検索API用の別アプリ（未実装時は未使用）
 */

const ENDPOINT_WITH_KEY = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401';
const ENDPOINT_LEGACY = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20170706';

function getConfig() {
  const applicationId = String(process.env.RAKUTEN_APPLICATION_ID ?? '').trim();
  const accessKey = String(process.env.RAKUTEN_ACCESS_KEY ?? '').trim();
  const affiliateId = String(process.env.RAKUTEN_AFFILIATE_ID ?? '').trim();
  return { applicationId, accessKey, affiliateId };
}

/** アプリケーションIDがあれば検索API利用可（アクセスキーは推奨） */
export function isRakutenWebServiceConfigured() {
  return !!getConfig().applicationId;
}

/**
 * キーワード検索で1ページ分の商品を取得し、shopCode の集合を返す
 * @param {{ keyword: string; page?: number; hits?: number }} opts
 * @returns {Promise<{ shopCodes: string[]; rawCount: number; error?: string }>}
 */
export async function fetchShopCodesFromItemSearch(opts) {
  const { applicationId, accessKey, affiliateId } = getConfig();
  if (!applicationId) {
    return { shopCodes: [], rawCount: 0, error: 'RAKUTEN_APPLICATION_ID 未設定' };
  }

  const keyword = String(opts.keyword ?? '').trim();
  const page = Math.max(1, Math.min(100, Number(opts.page) || 1));
  const hits = Math.max(1, Math.min(30, Number(opts.hits) || 30));

  const useNew = !!accessKey;
  const urlBase = useNew ? ENDPOINT_WITH_KEY : ENDPOINT_LEGACY;
  const params = new URLSearchParams({
    applicationId,
    keyword,
    page: String(page),
    hits: String(hits),
    format: 'json',
    formatVersion: '2',
  });
  if (useNew) params.set('accessKey', accessKey);
  if (affiliateId) params.set('affiliateId', affiliateId);

  const url = `${urlBase}?${params.toString()}`;
  const res = await fetch(url);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { shopCodes: [], rawCount: 0, error: `JSON parse失敗 HTTP ${res.status}` };
  }

  if (data.errors?.errorMessage) {
    return {
      shopCodes: [],
      rawCount: 0,
      error: `${data.errors.errorMessage}（HTTP ${data.errors.errorCode ?? res.status}）`,
    };
  }

  if (data.error) {
    return {
      shopCodes: [],
      rawCount: 0,
      error: `${data.error}: ${data.error_description ?? ''}`.trim(),
    };
  }

  if (!res.ok) {
    return {
      shopCodes: [],
      rawCount: 0,
      error: `HTTP ${res.status}`,
    };
  }

  const items = data.items ?? data.Items ?? [];
  const shopCodes = new Set();
  for (const row of items) {
    const it = row?.item ?? row;
    const code = String(it?.shopCode ?? '').trim();
    if (code) shopCodes.add(code);
  }

  return { shopCodes: [...shopCodes], rawCount: items.length };
}

/**
 * 特定のショップがキーワードにマッチする商品を持つか確認
 * shopCode フィルタ付きで 1件だけ取得し、件数を返す。
 * 0 → そのショップにはその商品がない。
 *
 * @param {{ shopCode: string; keyword: string }} opts
 * @returns {Promise<{ count: number; error?: string }>}
 */
export async function fetchShopItemCountForVerify(opts) {
  const { applicationId, accessKey, affiliateId } = getConfig();
  if (!applicationId) {
    return { count: -1, error: 'RAKUTEN_APPLICATION_ID 未設定' };
  }

  const keyword = String(opts.keyword ?? '').trim();
  const shopCode = String(opts.shopCode ?? '').trim();
  if (!shopCode) return { count: -1, error: 'shopCode 未指定' };

  const useNew = !!accessKey;
  const urlBase = useNew ? ENDPOINT_WITH_KEY : ENDPOINT_LEGACY;
  const params = new URLSearchParams({
    applicationId,
    keyword,
    shopCode,
    page: '1',
    hits: '1',            // 1件だけ取れれば十分
    format: 'json',
    formatVersion: '2',
  });
  if (useNew) params.set('accessKey', accessKey);
  if (affiliateId) params.set('affiliateId', affiliateId);

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const backoffs = [0, 3000, 8000, 20000]; // 429 時のバックオフ

  for (let attempt = 0; attempt < backoffs.length; attempt++) {
    if (backoffs[attempt] > 0) await sleep(backoffs[attempt] + Math.random() * 1000);
    try {
      const res = await fetch(`${urlBase}?${params.toString()}`);
      if (res.status === 429) {
        if (attempt === backoffs.length - 1) return { count: -1, error: 'HTTP 429 Too Many Requests' };
        continue; // バックオフして再試行
      }
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch {
        return { count: -1, error: `JSON parse失敗 HTTP ${res.status}` };
      }
      if (data.errors?.errorMessage) return { count: -1, error: data.errors.errorMessage };
      if (data.error) return { count: -1, error: data.error };
      if (!res.ok) return { count: -1, error: `HTTP ${res.status}` };

      const total = Number(data.count ?? data.Count ?? 0);
      return { count: total };
    } catch (err) {
      if (attempt === backoffs.length - 1) return { count: -1, error: String(err?.message ?? err) };
    }
  }
  return { count: -1, error: '全リトライ失敗' };
}
