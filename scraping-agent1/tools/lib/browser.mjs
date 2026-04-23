/**
 * browser.mjs — Puppeteer ヘルパー(JS描画ページ用)
 *
 * ヘッドレス Chrome でページを開き、JS実行後のHTMLを取得する。
 * 無限スクロール・ページネーション・SPA などに対応。
 *
 * 静的 HTML で済むなら fetch.mjs を使う方が速い。
 */

import puppeteer from "puppeteer";
import * as cheerio from "cheerio";
import {
  DEFAULT_USER_AGENT,
  Throttle,
  detectBlock,
  BlockedError,
  sleep,
} from "./throttle.mjs";

const DEFAULT_NAV_TIMEOUT_MS = 45_000;
const DEFAULT_WAIT_AFTER_LOAD_MS = 1500;

/**
 * Puppeteer ブラウザを起動
 * 複数ページを連続処理する場合は、一度起動して使い回す
 */
export async function launchBrowser(options = {}) {
  return await puppeteer.launch({
    headless: options.headless ?? true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
    ],
  });
}

/**
 * ページを開いて JS 実行後の HTML を取得
 *
 * @param {import('puppeteer').Browser} browser
 * @param {string} url
 * @param {object} [options]
 * @param {Throttle} [options.throttle]
 * @param {number} [options.waitAfterLoadMs] - ページロード後の追加待機(ms)
 * @param {"networkidle2" | "networkidle0" | "domcontentloaded" | "load"} [options.waitUntil]
 * @param {"full" | number} [options.scroll] - "full" なら無限スクロールを最後まで、数値ならその回数スクロール
 * @param {string} [options.waitForSelector] - このセレクタが出現するまで待つ
 * @returns {Promise<{ $: cheerio.CheerioAPI, html: string, title: string, finalUrl: string }>}
 */
export async function fetchWithBrowser(browser, url, options = {}) {
  const {
    throttle,
    waitAfterLoadMs = DEFAULT_WAIT_AFTER_LOAD_MS,
    waitUntil = "networkidle2",
    scroll,
    waitForSelector,
    extraHeaders = {},
  } = options;

  if (throttle) {
    throttle.ensureRunning();
    await throttle.waitForNext();
  }

  const page = await browser.newPage();
  try {
    await page.setUserAgent(DEFAULT_USER_AGENT);
    await page.setViewport({ width: 1440, height: 900 });
    await page.setExtraHTTPHeaders({
      "Accept-Language": "ja,en;q=0.9",
      ...extraHeaders,
    });

    // webdriver 隠蔽(アンチボット対策の最低限)
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const response = await page.goto(url, {
      waitUntil,
      timeout: DEFAULT_NAV_TIMEOUT_MS,
    });

    if (response) {
      const status = response.status();
      if (status >= 400) {
        if (throttle) throttle.recordFailure(`HTTP ${status}`);
        const snippet = await page.content().catch(() => "");
        const block = detectBlock(snippet);
        if (block) {
          if (throttle) throttle.stop(block);
          throw new BlockedError(block);
        }
        if (status === 403) {
          if (throttle) throttle.stop(`HTTP 403`);
          throw new BlockedError(`HTTP 403 (Forbidden)`);
        }
      }
    }

    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: 15_000 }).catch(() => {});
    }

    if (waitAfterLoadMs > 0) {
      await sleep(waitAfterLoadMs);
    }

    if (scroll === "full") {
      await autoScroll(page);
    } else if (typeof scroll === "number" && scroll > 0) {
      await manualScroll(page, scroll);
    }

    const html = await page.content();
    const title = (await page.title()) || "";
    const finalUrl = page.url();

    const block = detectBlock(html);
    if (block) {
      if (throttle) throttle.stop(block);
      throw new BlockedError(block);
    }

    if (throttle) throttle.recordSuccess();

    const $ = cheerio.load(html);
    return { $, html, title, finalUrl };
  } finally {
    await page.close();
  }
}

/**
 * 無限スクロールを最後まで実行
 * 何度かスクロールしても高さが変わらなくなるまで続ける
 */
async function autoScroll(page, options = {}) {
  const { maxRounds = 30, stepDelayMs = 800, stableRounds = 3 } = options;
  await page.evaluate(
    async ({ maxRounds, stepDelayMs, stableRounds }) => {
      await new Promise((resolve) => {
        let lastHeight = 0;
        let stable = 0;
        let round = 0;
        const tick = () => {
          window.scrollBy(0, window.innerHeight);
          setTimeout(() => {
            const h = document.documentElement.scrollHeight;
            if (h === lastHeight) {
              stable++;
            } else {
              stable = 0;
              lastHeight = h;
            }
            round++;
            if (stable >= stableRounds || round >= maxRounds) {
              window.scrollTo(0, 0);
              resolve();
            } else {
              tick();
            }
          }, stepDelayMs);
        };
        tick();
      });
    },
    { maxRounds, stepDelayMs, stableRounds }
  );
}

async function manualScroll(page, count) {
  for (let i = 0; i < count; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await sleep(800);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}
