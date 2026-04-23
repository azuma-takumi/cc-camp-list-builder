/**
 * fetch.mjs — 静的HTML取得(cheerio ベース)
 *
 * 軽量で高速。JavaScript で描画されないページ向け。
 * JSON/APIレスポンスも扱える。
 *
 * JS描画が必要なページは browser.mjs (Puppeteer) を使う。
 */

import * as cheerio from "cheerio";
import {
  DEFAULT_USER_AGENT,
  Throttle,
  withRetry,
  classifyStatus,
  detectBlock,
  BlockedError,
  sleep,
} from "./throttle.mjs";

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

/**
 * URL から HTML を取得して cheerio でパースする
 *
 * @param {string} url
 * @param {{ throttle?: Throttle, timeoutMs?: number, extraHeaders?: object }} [options]
 * @returns {Promise<{ $: cheerio.CheerioAPI, html: string, status: number, url: string }>}
 */
export async function fetchHtml(url, options = {}) {
  const { throttle, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, extraHeaders = {} } = options;
  if (throttle) {
    throttle.ensureRunning();
    await throttle.waitForNext();
  }

  const result = await withRetry(
    async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res;
      try {
        res = await fetch(url, {
          method: "GET",
          headers: {
            "User-Agent": DEFAULT_USER_AGENT,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ja,en;q=0.9",
            ...extraHeaders,
          },
          signal: ctrl.signal,
          redirect: "follow",
        });
      } finally {
        clearTimeout(timer);
      }

      const headers = Object.fromEntries(res.headers.entries());
      const verdict = classifyStatus(res.status, headers);

      if (verdict.action === "retry") {
        if (verdict.waitMs) await sleep(verdict.waitMs);
        throw new Error(`Retryable: ${verdict.reason}`);
      }
      if (verdict.action === "stop") {
        if (throttle) throttle.stop(verdict.reason);
        throw new BlockedError(verdict.reason);
      }

      const html = await res.text();
      const block = detectBlock(html, headers);
      if (block) {
        if (throttle) throttle.stop(block);
        throw new BlockedError(block);
      }

      return { html, status: res.status, finalUrl: res.url };
    },
    { throttle, onRetry: ({ attempt, wait, error }) => {
      console.warn(`[fetch] リトライ(${attempt + 1}回目), ${wait}ms待機: ${error.message}`);
    } }
  );

  if (throttle) throttle.recordSuccess();

  const $ = cheerio.load(result.html);
  return { $, html: result.html, status: result.status, url: result.finalUrl };
}

/**
 * URL から JSON を取得する(API直叩き用)
 */
export async function fetchJson(url, options = {}) {
  const { throttle, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, extraHeaders = {} } = options;
  if (throttle) {
    throttle.ensureRunning();
    await throttle.waitForNext();
  }

  const result = await withRetry(
    async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res;
      try {
        res = await fetch(url, {
          method: "GET",
          headers: {
            "User-Agent": DEFAULT_USER_AGENT,
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "ja,en;q=0.9",
            ...extraHeaders,
          },
          signal: ctrl.signal,
          redirect: "follow",
        });
      } finally {
        clearTimeout(timer);
      }

      const headers = Object.fromEntries(res.headers.entries());
      const verdict = classifyStatus(res.status, headers);
      if (verdict.action === "retry") {
        if (verdict.waitMs) await sleep(verdict.waitMs);
        throw new Error(`Retryable: ${verdict.reason}`);
      }
      if (verdict.action === "stop") {
        if (throttle) throttle.stop(verdict.reason);
        throw new BlockedError(verdict.reason);
      }

      const json = await res.json();
      return { json, status: res.status, finalUrl: res.url };
    },
    { throttle }
  );

  if (throttle) throttle.recordSuccess();
  return { data: result.json, status: result.status, url: result.finalUrl };
}

/**
 * 簡易的に「このページは動的(JS必須)か?」を判定するヒューリスティック
 *
 * - <body> が空 or 極端に短い
 * - 明示的な SPA マーカー(noscript で「JSを有効にして」等)
 * - JSON-LD / main 要素のテキストが少ない
 *
 * @returns {{ looksDynamic: boolean, reason?: string }}
 */
export function looksDynamicPage($, html) {
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  if (bodyText.length < 300) {
    return { looksDynamic: true, reason: "body テキストが短い" };
  }

  const noscript = $("noscript").text().toLowerCase();
  if (
    noscript.includes("enable javascript") ||
    noscript.includes("javascript を有効") ||
    noscript.includes("javascriptを有効")
  ) {
    return { looksDynamic: true, reason: "noscript で JS 必須の指示あり" };
  }

  // 代表的な SPA ルートが空っぽ
  const spaRoots = ["#root", "#app", "#__next"];
  for (const sel of spaRoots) {
    const el = $(sel);
    if (el.length > 0) {
      const text = el.text().replace(/\s+/g, " ").trim();
      if (text.length < 100) {
        return { looksDynamic: true, reason: `${sel} が空(SPAの可能性)` };
      }
    }
  }

  return { looksDynamic: false };
}
