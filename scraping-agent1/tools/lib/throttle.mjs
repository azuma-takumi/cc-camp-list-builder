/**
 * throttle.mjs — リクエスト間隔の制御、リトライ、エラー検知
 *
 * 礼儀正しいクローラーの実装:
 *   - リクエスト間隔(ジッター付き): デフォルト 2秒 ± 1秒
 *   - 並列数: 1(直列実行)
 *   - 429/503 の自動リトライ(指数バックオフ、Retry-After 尊重)
 *   - Cloudflare / Captcha 検知で即停止
 *   - 連続失敗カウントで自動停止
 */

import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "..", ".env") });

export const DEFAULT_DELAY_MS = parseInt(process.env.SCRAPE_DELAY_MS || "2000", 10);
export const DEFAULT_JITTER_MS = 1000;
export const DEFAULT_USER_AGENT =
  process.env.SCRAPE_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_RETRIES = 3;

/**
 * スクレイピングの実行状態を管理するクラス
 *
 * - 前回リクエストからの経過時間を見て待機する
 * - エラーの連続回数をカウントして自動停止
 * - サイトごとのカスタム間隔を適用できる
 */
export class Throttle {
  constructor(options = {}) {
    this.delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
    this.jitterMs = options.jitterMs ?? DEFAULT_JITTER_MS;
    this.lastRequestTime = 0;
    this.consecutiveFailures = 0;
    this.maxConsecutiveFailures = options.maxConsecutiveFailures ?? MAX_CONSECUTIVE_FAILURES;
    this.stopped = false;
    this.stopReason = "";
  }

  /**
   * 次のリクエストまで待機する(前回実行時刻+delay以降になるまで)
   */
  async waitForNext() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    const jitter = Math.floor(Math.random() * this.jitterMs);
    const wait = Math.max(0, this.delayMs + jitter - elapsed);
    if (wait > 0) {
      await sleep(wait);
    }
    this.lastRequestTime = Date.now();
  }

  recordSuccess() {
    this.consecutiveFailures = 0;
  }

  recordFailure(reason = "") {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      this.stopped = true;
      this.stopReason = `連続${this.consecutiveFailures}回失敗: ${reason}`;
    }
  }

  /** 致命的なエラー(Cloudflare等)で即停止 */
  stop(reason) {
    this.stopped = true;
    this.stopReason = reason;
  }

  ensureRunning() {
    if (this.stopped) {
      throw new ScrapeStoppedError(this.stopReason);
    }
  }
}

export class ScrapeStoppedError extends Error {
  constructor(message) {
    super(`スクレイピングを停止しました: ${message}`);
    this.name = "ScrapeStoppedError";
  }
}

export class BlockedError extends Error {
  constructor(message) {
    super(`アクセスがブロックされた可能性: ${message}`);
    this.name = "BlockedError";
  }
}

/**
 * fetch レスポンスからアンチボット/ブロックを検知
 */
export function detectBlock(html, headers = {}) {
  const lower = (html || "").toLowerCase().slice(0, 5000);
  // Cloudflare
  if (lower.includes("cloudflare") && (lower.includes("checking your browser") || lower.includes("cf-ray"))) {
    return "Cloudflare のチャレンジページ";
  }
  if (headers["cf-mitigated"]) {
    return "Cloudflare がアクセスを制限";
  }
  // reCAPTCHA / hCaptcha
  if (lower.includes("g-recaptcha") || lower.includes("hcaptcha") || lower.includes("h-captcha")) {
    return "CAPTCHA の表示を検知";
  }
  // 一般的なブロックページ
  if (lower.includes("access denied") || lower.includes("please enable cookies and javascript")) {
    return "アクセス拒否ページの可能性";
  }
  return null;
}

/**
 * HTTP ステータスコードから挙動を判断
 *
 * @returns {{ action: "ok" | "retry" | "stop", waitMs?: number, reason?: string }}
 */
export function classifyStatus(status, headers = {}) {
  if (status >= 200 && status < 300) return { action: "ok" };

  if (status === 429 || status === 503) {
    const retryAfter = headers["retry-after"];
    let waitMs = 60_000;
    if (retryAfter) {
      const secs = parseInt(retryAfter, 10);
      if (!isNaN(secs)) waitMs = Math.min(secs * 1000, 5 * 60_000); // 最大5分
    }
    return { action: "retry", waitMs, reason: `HTTP ${status}` };
  }

  if (status === 403) {
    return { action: "stop", reason: "HTTP 403 (Forbidden) — アクセス制限された可能性" };
  }

  if (status >= 500) {
    return { action: "retry", waitMs: 5_000, reason: `HTTP ${status}` };
  }

  if (status === 404) {
    return { action: "ok", reason: "HTTP 404" };
  }

  return { action: "retry", waitMs: 3_000, reason: `HTTP ${status}` };
}

/**
 * 指定関数を、リトライ+指数バックオフで実行する
 *
 * @param {() => Promise<any>} fn
 * @param {{ maxRetries?: number, baseDelayMs?: number, throttle?: Throttle }} options
 */
export async function withRetry(fn, options = {}) {
  const { maxRetries = MAX_RETRIES, baseDelayMs = 1000, throttle, onRetry } = options;
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (throttle) throttle.ensureRunning();
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err instanceof ScrapeStoppedError || err instanceof BlockedError) {
        throw err; // 即座に伝播
      }
      if (attempt === maxRetries) break;
      const wait = baseDelayMs * Math.pow(2, attempt);
      if (onRetry) onRetry({ attempt, wait, error: err });
      await sleep(wait);
    }
  }
  throw lastErr;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
