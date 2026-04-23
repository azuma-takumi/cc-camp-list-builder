/**
 * scraper.mjs — スクレイパー統合(自動判定 + 礼儀正しい実行)
 *
 * エージェントから使う高レベルAPI:
 *   - fetchPage(url, options)        静的/JS描画を自動判定してHTMLを取得
 *   - crawlList(listUrl, options)    リストページから複数項目を取得(ページネーション含む)
 *   - crawlDetails(urls, visitor)    複数の詳細URLを順に訪問して情報を抽出
 *
 * どれも Throttle と robots.txt チェックが組み込まれている。
 */

import { fetchHtml, looksDynamicPage } from "./fetch.mjs";
import { launchBrowser, fetchWithBrowser } from "./browser.mjs";
import { checkRobots } from "./robots.mjs";
import { Throttle, ScrapeStoppedError, BlockedError } from "./throttle.mjs";
import { getProfile, saveProfile } from "./scrape-profiles.mjs";

/**
 * URL を1つ取得する(自動判定)
 *
 * 流れ:
 *   1. robots.txt チェック(禁止なら throw)
 *   2. まず fetch で試す
 *   3. 「JS描画が必要そう」と判定 or 明示指定 → Puppeteer で再取得
 *
 * @param {string} url
 * @param {object} [options]
 * @param {Throttle} [options.throttle] - 外から渡す(複数ページを同じ間隔制御で処理する場合)
 * @param {"auto" | "static" | "browser"} [options.mode] - デフォルト "auto"
 * @param {object} [options.browserOptions] - Puppeteer固有オプション(scroll, waitForSelector 等)
 * @param {boolean} [options.respectRobots] - デフォルト true。false にすると robots.txt 無視(警告付き)
 * @returns {Promise<{ $: import('cheerio').CheerioAPI, html: string, title: string, finalUrl: string, mode: "static" | "browser" }>}
 */
export async function fetchPage(url, options = {}) {
  const {
    throttle = new Throttle(await buildThrottleOptionsForUrl(url)),
    mode = "auto",
    browserOptions = {},
    respectRobots = true,
  } = options;

  if (respectRobots) {
    const robots = await checkRobots(url);
    if (!robots.allowed) {
      throw new RobotsDisallowedError(
        `robots.txt によって ${url} はアクセス禁止(${robots.rule})`
      );
    }
    if (robots.crawlDelay && robots.crawlDelay * 1000 > throttle.delayMs) {
      throttle.delayMs = robots.crawlDelay * 1000;
    }
  }

  if (mode === "browser") {
    const browser = options.browser || (await launchBrowser());
    const shouldClose = !options.browser;
    try {
      const res = await fetchWithBrowser(browser, url, { throttle, ...browserOptions });
      return { ...res, mode: "browser" };
    } finally {
      if (shouldClose) await browser.close();
    }
  }

  if (mode === "static") {
    const res = await fetchHtml(url, { throttle });
    return { ...res, title: $$title(res.$), mode: "static" };
  }

  // auto: まず static
  const staticRes = await fetchHtml(url, { throttle });
  const dyn = looksDynamicPage(staticRes.$, staticRes.html);
  if (!dyn.looksDynamic) {
    return { ...staticRes, title: $$title(staticRes.$), mode: "static" };
  }

  // JS描画が必要そう → Puppeteer で再取得
  console.log(`[scraper] 動的ページと判定(${dyn.reason}) → ブラウザで再取得: ${url}`);
  const browser = options.browser || (await launchBrowser());
  const shouldClose = !options.browser;
  try {
    const res = await fetchWithBrowser(browser, url, { throttle, ...browserOptions });
    return { ...res, mode: "browser" };
  } finally {
    if (shouldClose) await browser.close();
  }
}

function $$title($) {
  return ($("title").first().text() || "").trim();
}

/**
 * 複数の詳細URLを順に訪問して、各ページから情報を抽出する
 *
 * @param {string[]} urls
 * @param {(context: { $: cheerio.CheerioAPI, html: string, url: string, title: string }) => object | null} extractor
 *   ページごとに呼ばれる。{ title, extras } 形式のオブジェクトを返す。null を返すとスキップ。
 * @param {object} [options]
 * @returns {Promise<{ items: Array<object>, errors: Array<{ url: string, error: string }> }>}
 */
export async function crawlDetails(urls, extractor, options = {}) {
  const {
    throttle = new Throttle(await buildThrottleOptionsForUrl(urls[0])),
    mode = "auto",
    browserOptions = {},
    respectRobots = true,
    onProgress,
  } = options;

  // Puppeteer を使う可能性があるので、必要になったときに起動して使い回す
  let browser = null;
  const ensureBrowser = async () => {
    if (!browser) browser = await launchBrowser();
    return browser;
  };

  const items = [];
  const errors = [];

  try {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      try {
        throttle.ensureRunning();

        const res = await fetchPage(url, {
          throttle,
          mode,
          browserOptions,
          respectRobots,
          browser: mode === "static" ? undefined : await ensureBrowser().catch(() => null),
        });

        const extracted = extractor({
          $: res.$,
          html: res.html,
          url: res.finalUrl || url,
          title: res.title,
        });

        if (extracted) {
          items.push({
            url: res.finalUrl || url,
            title: extracted.title || res.title || url,
            extras: extracted.extras || {},
          });
        }
        if (onProgress) onProgress({ index: i + 1, total: urls.length, url, ok: true });
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        errors.push({ url, error: msg });
        if (onProgress) onProgress({ index: i + 1, total: urls.length, url, ok: false, error: msg });

        if (err instanceof ScrapeStoppedError || err instanceof BlockedError) {
          console.warn(`[scraper] 停止: ${msg}`);
          break; // これ以上続けない
        }
      }
    }
  } finally {
    if (browser) await browser.close();

    // サイト別プロファイルを更新
    if (urls.length > 0) {
      const origin = safeOrigin(urls[0]);
      if (origin) {
        await saveProfile(origin, {
          lastUsed: new Date().toISOString(),
          delayMs: throttle.delayMs,
          observed: {
            ok: items.length,
            errors: errors.length,
          },
        });
      }
    }
  }

  return { items, errors };
}

/**
 * リストページから URL を抽出する(CSSセレクタ指定)
 *
 * @param {string} listUrl
 * @param {object} options
 * @param {string} options.itemSelector - 各項目の要素(例: ".shop-card")
 * @param {(el: cheerio.Cheerio, $: cheerio.CheerioAPI) => { title: string, url: string, extras?: object } | null} options.parseItem
 * @param {Throttle} [options.throttle]
 * @param {"auto" | "static" | "browser"} [options.mode]
 * @param {object} [options.browserOptions]
 * @param {number} [options.maxItems] - 件数上限
 * @returns {Promise<Array<{ title: string, url: string, extras?: object }>>}
 */
export async function extractListItems(listUrl, options) {
  const { itemSelector, parseItem, maxItems = 100 } = options;
  const { $, finalUrl } = await fetchPage(listUrl, options);

  const items = [];
  $(itemSelector).each((_, el) => {
    if (items.length >= maxItems) return false;
    const parsed = parseItem($(el), $);
    if (!parsed) return;
    // 相対URL → 絶対URLに解決
    if (parsed.url) {
      try {
        parsed.url = new URL(parsed.url, finalUrl || listUrl).toString();
      } catch {
        // 解決できないURLは捨てる
        return;
      }
    }
    items.push(parsed);
  });
  return items;
}

/**
 * URL からドメインを取り出す(profiles キー用)
 */
function safeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * サイト別プロファイルから、このURL向けの Throttle オプションを構築
 */
async function buildThrottleOptionsForUrl(url) {
  const origin = safeOrigin(url);
  if (!origin) return {};
  const profile = await getProfile(origin);
  if (!profile) return {};
  return {
    delayMs: profile.delayMs,
  };
}

export class RobotsDisallowedError extends Error {
  constructor(message) {
    super(message);
    this.name = "RobotsDisallowedError";
  }
}
