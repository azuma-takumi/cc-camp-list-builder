/**
 * robots.mjs — robots.txt の簡易パーサーとチェッカー
 *
 * 仕様: https://www.rfc-editor.org/rfc/rfc9309.html
 *
 * 使い方:
 *   const { allowed, rules } = await checkRobots("https://example.com/some/path");
 *   if (!allowed) { 警告を出してユーザーに確認 }
 *
 * キャッシュ: ドメイン単位で1時間メモリキャッシュ
 */

import { DEFAULT_USER_AGENT } from "./throttle.mjs";

const CACHE = new Map(); // origin => { rules, fetchedAt }
const CACHE_TTL_MS = 60 * 60 * 1000; // 1時間
const FETCH_TIMEOUT_MS = 10_000;

/**
 * 指定URLが robots.txt で許可されているか判定
 *
 * @param {string} url - チェックしたいURL
 * @param {string} [userAgent]
 * @returns {Promise<{ allowed: boolean, rule?: string, sitemap?: string[], crawlDelay?: number }>}
 */
export async function checkRobots(url, userAgent = DEFAULT_USER_AGENT) {
  const parsed = new URL(url);
  const origin = parsed.origin;
  const pathWithQuery = parsed.pathname + parsed.search;

  const rules = await loadRobots(origin);
  if (!rules) {
    // robots.txt が取れない = 明示的な禁止はないので allowed
    return { allowed: true, sitemap: [], crawlDelay: null };
  }

  const matched = matchUserAgent(rules.groups, userAgent);
  const group = matched || rules.groups.find((g) => g.agents.includes("*")) || null;

  if (!group) {
    return { allowed: true, sitemap: rules.sitemap, crawlDelay: null };
  }

  // Allow は Disallow より優先(最長マッチ)
  const allowMatch = longestMatch(group.allow, pathWithQuery);
  const disallowMatch = longestMatch(group.disallow, pathWithQuery);

  let allowed = true;
  let rule;
  if (disallowMatch && (!allowMatch || disallowMatch.length > allowMatch.length)) {
    allowed = false;
    rule = `Disallow: ${disallowMatch}`;
  } else if (allowMatch) {
    rule = `Allow: ${allowMatch}`;
  }

  return {
    allowed,
    rule,
    sitemap: rules.sitemap,
    crawlDelay: group.crawlDelay,
  };
}

/**
 * robots.txt をダウンロードしてパースする(キャッシュあり)
 */
async function loadRobots(origin) {
  const cached = CACHE.get(origin);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rules;
  }

  const robotsUrl = `${origin}/robots.txt`;
  let text = null;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(robotsUrl, {
      headers: { "User-Agent": DEFAULT_USER_AGENT },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (res.status >= 200 && res.status < 300) {
      text = await res.text();
    } else if (res.status >= 400 && res.status < 500) {
      // 404 等 = robots.txt なし = 全許可とみなす
      text = "";
    } else {
      // 5xx: 全拒否とみなす保守的な扱いもあるが、ここでは allowed にしておく
      text = "";
    }
  } catch {
    text = null; // 取得失敗
  }

  const rules = text === null ? null : parseRobots(text);
  CACHE.set(origin, { rules, fetchedAt: Date.now() });
  return rules;
}

/**
 * robots.txt をパースして { groups, sitemap } に変換
 */
export function parseRobots(text) {
  const groups = [];
  let current = null;
  const sitemap = [];

  const lines = text.split(/\r?\n/);
  for (let raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === "user-agent") {
      if (!current || current.hasRules) {
        current = { agents: [value], allow: [], disallow: [], crawlDelay: null, hasRules: false };
        groups.push(current);
      } else {
        current.agents.push(value);
      }
    } else if (key === "allow" && current) {
      current.allow.push(value);
      current.hasRules = true;
    } else if (key === "disallow" && current) {
      current.disallow.push(value);
      current.hasRules = true;
    } else if (key === "crawl-delay" && current) {
      const n = parseFloat(value);
      if (!isNaN(n)) current.crawlDelay = n;
      current.hasRules = true;
    } else if (key === "sitemap") {
      sitemap.push(value);
    }
  }

  return { groups, sitemap };
}

/**
 * UA文字列から、マッチするグループを探す(長いUAがより優先)
 */
function matchUserAgent(groups, userAgent) {
  const lower = userAgent.toLowerCase();
  let best = null;
  let bestLen = 0;
  for (const g of groups) {
    for (const agent of g.agents) {
      if (agent === "*") continue;
      if (lower.includes(agent.toLowerCase()) && agent.length > bestLen) {
        best = g;
        bestLen = agent.length;
      }
    }
  }
  return best;
}

/**
 * path に対する最長マッチのルールを返す
 */
function longestMatch(patterns, path) {
  let bestMatch = null;
  let bestLen = -1;
  for (const pattern of patterns) {
    if (pattern === "") continue; // 空の Disallow は「何も禁止しない」
    if (matchPattern(pattern, path) && pattern.length > bestLen) {
      bestMatch = pattern;
      bestLen = pattern.length;
    }
  }
  return bestMatch;
}

/**
 * robots.txt の簡易パターンマッチ
 * - "*" は任意の文字列
 * - 末尾の "$" は行末
 */
function matchPattern(pattern, path) {
  if (pattern === "/") return true;
  // 正規表現にエスケープ → "*" と "$" のみ特殊扱い
  let regexStr = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      regexStr += ".*";
    } else if (ch === "$" && i === pattern.length - 1) {
      regexStr += "$";
    } else {
      regexStr += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(regexStr).test(path);
}
