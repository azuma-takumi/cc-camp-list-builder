#!/usr/bin/env node

/**
 * research.mjs — 設定駆動のリサーチ実行エンジン
 *
 * 3つのモードをサポート:
 *   - single        : 1つ〜数個の URL から情報を取る
 *   - list-detail   : 一覧ページから詳細URLを抽出 → 各詳細ページから情報取得
 *   - search-based  : Brave 検索 → ヒットした URL を訪問して情報取得
 *
 * Usage:
 *   node tools/research.mjs --config path/to/config.json
 *   node tools/research.mjs --config path/to/config.json --dry-run
 *   cat config.json | node tools/research.mjs --config -     # stdin から受け取る
 *
 * config.json の例は scrapers/_template.mjs 参照。
 */

import { readFileSync } from "fs";
import {
  appendResearchRows,
  createResearchSheet,
  addCustomColumns,
  buildSheetName,
  sheetExists,
} from "./lib/sheets.mjs";
import { fetchPage } from "./lib/scraper.mjs";
import { searchWebBulk } from "./lib/brave-search.mjs";
import { searchPlacesTextBulk } from "./lib/google-places.mjs";
import { searchYouTubeBulk } from "./lib/youtube.mjs";
import {
  Throttle,
  ScrapeStoppedError,
  BlockedError,
  sleep,
} from "./lib/throttle.mjs";
import { launchBrowser } from "./lib/browser.mjs";
import {
  startSession,
  buildUsageReport,
  formatUsageReportMarkdown,
} from "./lib/usage.mjs";

// ========================================
// フィールド抽出ユーティリティ
// ========================================

/**
 * フィールド定義に従って値を抽出
 *
 * field = {
 *   selector: ".price",
 *   extract: "text" | "html" | "attr" | "list",
 *   attr?: "href",       // extract=attr のとき
 *   join?: " / ",        // extract=list のとき
 *   transform?: "trim" | "numeric" | "...",  // 後処理
 * }
 */
export function extractField($, root, field) {
  if (!field || !field.selector) return "";
  const ctx = root ? $(root) : $.root();
  const el = field.selector === ":self" ? ctx : ctx.find(field.selector);
  if (el.length === 0) return "";

  let value;
  switch (field.extract || "text") {
    case "text":
      value = el.first().text();
      break;
    case "html":
      value = el.first().html() || "";
      break;
    case "attr":
      value = el.first().attr(field.attr || "href") || "";
      break;
    case "list":
      value = el
        .map((_, e) => $(e).text().trim())
        .get()
        .filter(Boolean)
        .join(field.join || " / ");
      break;
    default:
      value = el.first().text();
  }

  value = String(value).replace(/\s+/g, " ").trim();

  switch (field.transform) {
    case "numeric": {
      const n = value.replace(/[^\d.-]/g, "");
      return n;
    }
    case "url-only":
      try {
        return new URL(value).toString();
      } catch {
        return value;
      }
    default:
      return value;
  }
}

export function extractAllFields($, root, fieldsMap) {
  const out = {};
  for (const [key, field] of Object.entries(fieldsMap || {})) {
    out[key] = extractField($, root, field);
  }
  return out;
}

/**
 * URL の path 末尾にサブパス suffix を連結する(? や # の query/fragment は落とす)
 *   例) https://a.com/b/?x=1 + "c/" → https://a.com/b/c/
 */
function withPathSuffix(url, suffix) {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    const base = u.pathname.endsWith("/") ? u.pathname : u.pathname + "/";
    u.pathname = base + suffix.replace(/^\/+/, "");
    return u.toString();
  } catch {
    return url;
  }
}

// ========================================
// ページネーション展開
// ========================================

function expandPaginationUrls(listConfig) {
  const urls = [];
  const initialUrls = Array.isArray(listConfig.urls) ? listConfig.urls : [];
  urls.push(...initialUrls);

  const p = listConfig.pagination;
  if (p && p.urlTemplate) {
    const start = p.startPage ?? 2;
    const max = p.maxPages ?? 3;
    for (let i = start; i <= max; i++) {
      urls.push(p.urlTemplate.replace("{page}", String(i)));
    }
  }
  return urls;
}

// ========================================
// モード: list-detail
// ========================================

async function runListDetail(config, { log, throttle, browser }) {
  const { list, detail, maxItems = 50 } = config;
  if (!list || !list.urls) {
    throw new Error("list-detail モードには list.urls が必要です");
  }

  const allListUrls = expandPaginationUrls(list);
  const itemsFound = [];

  // リストページ巡回: 詳細URL(と、ここで取れる情報)を集める
  for (const listUrl of allListUrls) {
    if (itemsFound.length >= maxItems) break;
    log(`[list] 取得中: ${listUrl}`);
    try {
      const { $, finalUrl } = await fetchPage(listUrl, {
        throttle,
        mode: list.mode || "auto",
        browser,
        browserOptions: list.browserOptions,
      });

      const itemSelector = list.itemSelector;
      if (!itemSelector) {
        throw new Error("list.itemSelector が必要です");
      }

      let count = 0;
      $(itemSelector).each((_, el) => {
        if (itemsFound.length >= maxItems) return false;

        const parsed = extractAllFields($, el, list.parseItem || {});
        // URL 正規化
        if (parsed.url) {
          try {
            parsed.url = new URL(parsed.url, finalUrl || listUrl).toString();
          } catch {
            return;
          }
        }
        if (!parsed.title && !parsed.url) return;

        itemsFound.push({
          title: parsed.title || parsed.url,
          url: parsed.url || "",
          extras: Object.fromEntries(
            Object.entries(parsed).filter(([k]) => k !== "title" && k !== "url")
          ),
        });
        count++;
      });
      log(`[list] 抽出: ${count}件 (累計 ${itemsFound.length})`);
    } catch (err) {
      log(`[list] エラー: ${err.message}`);
      if (err instanceof ScrapeStoppedError || err instanceof BlockedError) break;
    }
  }

  // 詳細ページ巡回
  if (detail && detail.fields && itemsFound.length > 0) {
    const targets = itemsFound.slice(0, maxItems);
    log(`[detail] ${targets.length}件の詳細ページを巡回`);

    for (let i = 0; i < targets.length; i++) {
      const item = targets[i];
      if (!item.url) continue;
      try {
        // detail.urlSuffix があれば item.url にサブパスを連結して取得
        //   例) /slnH000145984/ + "map/" → /slnH000145984/map/
        const primaryUrl = detail.urlSuffix
          ? withPathSuffix(item.url, detail.urlSuffix)
          : item.url;
        const { $ } = await fetchPage(primaryUrl, {
          throttle,
          mode: detail.mode || "auto",
          browser,
          browserOptions: detail.browserOptions,
        });
        const detailFields = extractAllFields($, null, detail.fields);
        item.extras = { ...(item.extras || {}), ...detailFields };

        // detail.extraPages: [{ suffix: "tel/", fields: { 電話番号: {...} } }]
        //   同じアイテムで追加のサブページを取得して field を集める
        for (const sub of detail.extraPages || []) {
          if (!sub.suffix || !sub.fields) continue;
          try {
            const subUrl = withPathSuffix(item.url, sub.suffix);
            const { $: $sub } = await fetchPage(subUrl, {
              throttle,
              mode: sub.mode || detail.mode || "auto",
              browser,
              browserOptions: sub.browserOptions || detail.browserOptions,
            });
            const subFields = extractAllFields($sub, null, sub.fields);
            item.extras = { ...(item.extras || {}), ...subFields };
          } catch (err) {
            log(`[detail] ${i + 1}/${targets.length} sub(${sub.suffix}) エラー: ${err.message}`);
          }
        }

        log(`[detail] ${i + 1}/${targets.length} OK: ${item.title}`);
      } catch (err) {
        log(`[detail] ${i + 1}/${targets.length} エラー (${item.title}): ${err.message}`);
        if (err instanceof ScrapeStoppedError || err instanceof BlockedError) break;
      }
    }
  }

  return itemsFound.slice(0, maxItems);
}

// ========================================
// モード: single
// ========================================

async function runSingle(config, { log, throttle, browser }) {
  const urls = Array.isArray(config.urls) ? config.urls : [];
  const fields = config.fields || {};
  const items = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    log(`[single] ${i + 1}/${urls.length} 取得中: ${url}`);
    try {
      const { $, title } = await fetchPage(url, {
        throttle,
        mode: config.mode || "auto",
        browser,
        browserOptions: config.browserOptions,
      });
      const extras = extractAllFields($, null, fields);
      items.push({
        title: extras.title || title || url,
        url,
        extras: Object.fromEntries(Object.entries(extras).filter(([k]) => k !== "title")),
      });
      log(`[single] ${i + 1}/${urls.length} OK`);
    } catch (err) {
      log(`[single] ${i + 1}/${urls.length} エラー: ${err.message}`);
      if (err instanceof ScrapeStoppedError || err instanceof BlockedError) break;
    }
  }

  return items;
}

// ========================================
// モード: search-based
// ========================================

async function runSearchBased(config, { log, throttle, browser }) {
  const { query, searchMax = 20, detail, searchOptions = {} } = config;
  if (!query) throw new Error("search-based モードには query が必要です");

  log(`[search] "${query}" を検索中...`);
  const results = await searchWebBulk(query, { maxResults: searchMax, ...searchOptions });
  log(`[search] ${results.length} 件ヒット`);

  const items = results.map((r) => ({
    title: r.title,
    url: r.url,
    extras: { 説明: r.description },
  }));

  if (detail && detail.fields) {
    log(`[detail] 各ヒット URL を訪問して追加情報を取得`);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        const { $ } = await fetchPage(item.url, {
          throttle,
          mode: detail.mode || "auto",
          browser,
          browserOptions: detail.browserOptions,
          respectRobots: true,
        });
        const extra = extractAllFields($, null, detail.fields);
        item.extras = { ...item.extras, ...extra };
        log(`[detail] ${i + 1}/${items.length} OK: ${item.title}`);
      } catch (err) {
        log(`[detail] ${i + 1}/${items.length} エラー (${item.title}): ${err.message}`);
        if (err instanceof ScrapeStoppedError || err instanceof BlockedError) break;
      }
    }
  }

  return items;
}

// ========================================
// モード: places (Google Places API)
// ========================================

/**
 * Google Places API (New) で店舗情報(電話・住所・営業時間など)を一括取得。
 *
 * config = {
 *   mode: "places",
 *   query: "新宿区 居酒屋",
 *   maxItems: 50,                  // 最大60件まで取れる(Places API 仕様)
 *   placesOptions: {
 *     languageCode: "ja",          // デフォ "ja"
 *     regionCode: "jp",            // デフォ "jp"
 *     openNow: false,              // 今営業中だけ
 *     minRating: 3.5,              // 評価フィルタ
 *     locationBias: { latitude: 35.69, longitude: 139.70, radius: 5000 },
 *     // fields は lib/google-places.mjs の DEFAULT_FIELDS を上書きしたい場合のみ
 *   },
 *   fieldMapping: {                // (任意) 出力列名のカスタマイズ
 *     "店名": "name",
 *     "住所": "address",
 *     "電話番号": "phone",
 *     "公式サイト": "website",
 *     "評価": "rating",
 *     "レビュー数": "userRatingCount",
 *     "営業時間": "hours",
 *     "GoogleMaps": "mapsUrl",
 *   }
 * }
 */
async function runPlaces(config, { log }) {
  const { query, maxItems = 50, placesOptions = {}, fieldMapping } = config;
  if (!query) throw new Error("places モードには query が必要です");

  log(`[places] "${query}" を Google Places API で検索中...`);
  const places = await searchPlacesTextBulk(query, {
    maxResults: maxItems,
    ...placesOptions,
  });
  log(`[places] ${places.length} 件取得`);

  // 出力列のマッピング(指定がなければデフォルト7列)
  const mapping = fieldMapping || {
    店名: "name",
    住所: "address",
    電話番号: "phone",
    公式サイト: "website",
    評価: "rating",
    レビュー数: "userRatingCount",
    営業時間: "hours",
    GoogleMaps: "mapsUrl",
    営業状態: "businessStatus",
  };

  const items = places.map((p) => {
    const extras = {};
    for (const [columnName, placeField] of Object.entries(mapping)) {
      const v = p[placeField];
      extras[columnName] = v === null || v === undefined ? "" : String(v);
    }
    return {
      title: p.name || p.address || "(名称不明)",
      url: p.mapsUrl || p.website || "",
      extras,
    };
  });

  return items;
}

// ========================================
// モード: youtube-search (YouTube Data API)
// ========================================

/**
 * YouTube Data API v3 で動画検索を行い、統計情報込みで一覧を取得する。
 *
 * config = {
 *   mode: "youtube-search",
 *   query: "Claude Code",
 *   maxItems: 20,
 *   youtubeOptions: {
 *     regionCode: "JP",             // デフォ "JP"
 *     relevanceLanguage: "ja",      // デフォ "ja"
 *     order: "relevance",           // relevance / date / viewCount / rating
 *     publishedAfter: "2026-01-01T00:00:00Z",
 *     publishedBefore: null,
 *     withStats: true,              // 再生数等の統計を取得(デフォ true)
 *   },
 *   fieldMapping: {                 // (任意) 出力列のカスタマイズ
 *     "チャンネル": "channel",
 *     "再生数": "viewCount",
 *     "高評価数": "likeCount",
 *     "コメント数": "commentCount",
 *     "投稿日": "publishedAt",
 *     "概要": "description",
 *   }
 * }
 */
async function runYouTubeSearch(config, { log }) {
  const { query, maxItems = 25, youtubeOptions = {}, fieldMapping } = config;
  if (!query) throw new Error("youtube-search モードには query が必要です");

  log(`[youtube] "${query}" を検索中...`);
  const videos = await searchYouTubeBulk(query, {
    maxResults: maxItems,
    ...youtubeOptions,
  });
  log(`[youtube] ${videos.length} 件取得`);

  const mapping = fieldMapping || {
    チャンネル: "channel",
    再生数: "viewCount",
    高評価数: "likeCount",
    コメント数: "commentCount",
    投稿日: "publishedAt",
    概要: "description",
  };

  const items = videos.map((v) => {
    const extras = {};
    for (const [columnName, field] of Object.entries(mapping)) {
      const val = v[field];
      extras[columnName] = val === null || val === undefined ? "" : String(val);
    }
    return {
      title: v.title || "(タイトル不明)",
      url: v.url || "",
      extras,
    };
  });

  return items;
}

// ========================================
// メインランナー
// ========================================

/**
 * 設定に従ってリサーチを実行し、スプシに書き込む
 *
 * @param {object} config
 * @param {object} [options]
 * @param {boolean} [options.dryRun] - true なら取得のみ、書き込まない
 * @param {(msg: string) => void} [options.log]
 */
export async function runResearch(config, options = {}) {
  const { dryRun = false, log = (m) => console.log(m) } = options;

  // 今回分の API 使用量カウンタをリセット(月次累計は .usage.json に保持)
  startSession();

  const throttle = new Throttle({
    delayMs: config.throttle?.delayMs,
    jitterMs: config.throttle?.jitterMs,
  });

  // 必要ならブラウザを起動(複数ページで使い回す)
  const needsBrowser =
    config.mode === "browser" ||
    config.list?.mode === "browser" ||
    config.detail?.mode === "browser" ||
    Boolean(config.list?.browserOptions) ||
    Boolean(config.detail?.browserOptions);
  let browser = null;
  if (needsBrowser) {
    log("[setup] Puppeteer ブラウザを起動");
    browser = await launchBrowser();
  }

  let items = [];
  try {
    switch (config.mode) {
      case "list-detail":
        items = await runListDetail(config, { log, throttle, browser });
        break;
      case "single":
        items = await runSingle(config, { log, throttle, browser });
        break;
      case "search-based":
        items = await runSearchBased(config, { log, throttle, browser });
        break;
      case "places":
        items = await runPlaces(config, { log });
        break;
      case "youtube-search":
        items = await runYouTubeSearch(config, { log });
        break;
      default:
        throw new Error(`未対応の mode: ${config.mode}`);
    }
  } finally {
    if (browser) await browser.close();
  }

  log(`[result] 取得 ${items.length} 件`);

  const usage = buildUsageReport();

  if (dryRun) {
    log("[dry-run] 書き込みはスキップ");
    return { items, written: 0, skipped: 0, usage };
  }

  // スプシに書き込み
  const sheetName = config.sheetName || buildSheetName(config.name || "リサーチ");
  const extraKeys = new Set();
  for (const it of items) {
    if (it.extras) for (const k of Object.keys(it.extras)) extraKeys.add(k);
  }

  if (!(await sheetExists(sheetName))) {
    log(`[sheet] 新規作成: ${sheetName}`);
    await createResearchSheet(sheetName, [...extraKeys]);
  } else {
    log(`[sheet] 既存シートに追記: ${sheetName}`);
    if (extraKeys.size > 0) {
      const addRes = await addCustomColumns(sheetName, [...extraKeys]);
      if (addRes.added.length > 0) {
        log(`[sheet] 新しい列を追加: ${addRes.added.join(", ")}`);
      }
    }
  }

  const res = await appendResearchRows(sheetName, items, { skipDuplicateUrls: true });
  log(`[sheet] 書き込み完了: 追加 ${res.appended} 件 / 重複スキップ ${res.skipped} 件`);

  return { items, written: res.appended, skipped: res.skipped, sheetName, usage };
}

// ========================================
// CLI エントリーポイント
// ========================================

async function loadConfig(pathOrStdin) {
  if (pathOrStdin === "-") {
    // stdin から読む
    const data = await new Promise((resolve) => {
      let buf = "";
      process.stdin.setEncoding("utf-8");
      process.stdin.on("data", (c) => (buf += c));
      process.stdin.on("end", () => resolve(buf));
    });
    return JSON.parse(data);
  }
  const raw = readFileSync(pathOrStdin, "utf-8");
  return JSON.parse(raw);
}

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function main() {
  const configPath = getArg("--config");
  if (!configPath) {
    console.error("Usage: node tools/research.mjs --config <path>  (- で stdin)");
    process.exit(1);
  }
  const config = await loadConfig(configPath);
  const dryRun = hasFlag("--dry-run");

  const result = await runResearch(config, { dryRun });

  console.log("");
  console.log("=== 完了 ===");
  console.log(`取得: ${result.items.length} 件`);
  if (!dryRun) {
    console.log(`書き込み: ${result.written} 件`);
    console.log(`スキップ: ${result.skipped} 件`);
    console.log(`シート: ${result.sheetName}`);
  } else {
    console.log("");
    console.log("--- サンプル(先頭3件) ---");
    console.log(JSON.stringify(result.items.slice(0, 3), null, 2));
  }

  // API 使用量レポート(session + 今月累計)
  if (result.usage) {
    console.log("");
    console.log(formatUsageReportMarkdown(result.usage));
  }
}

// メインが直接実行された場合のみ走らせる
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("research.mjs");
if (isMain) {
  main().catch((err) => {
    console.error("Error:", err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  });
}
