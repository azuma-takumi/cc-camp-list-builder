#!/usr/bin/env node

/**
 * research-helpers.mjs — エージェントがリサーチ対話中に呼ぶ補助コマンド
 *
 * サブコマンド一覧:
 *   create-sheet    — 新しいリサーチシートを作成
 *   inspect-page    — 1ページを取得して「何が取れそうか」の簡易レポート
 *   search          — Brave Search API で検索
 *   append-rows     — シートに行を追加 (JSON で items を渡す)
 *   list-sheets     — 既存のリサーチシート一覧
 *
 * 使用例:
 *   node tools/research-helpers.mjs create-sheet --name "新宿_居酒屋" \
 *       --columns "住所,電話番号,ジャンル,席数"
 *   node tools/research-helpers.mjs inspect-page \
 *       --url "https://tabelog.com/tokyo/A1304/rstLst/izakaya/"
 *   node tools/research-helpers.mjs search \
 *       --query "新宿 居酒屋 ホームページ" --max 20
 *   node tools/research-helpers.mjs list-sheets
 *
 * append-rows は stdin から JSON を受け取る:
 *   echo '[{"title":"◯◯","url":"https://...","extras":{"住所":"..."}}]' \
 *     | node tools/research-helpers.mjs append-rows --sheet "20260420_新宿_居酒屋"
 */

import {
  buildSheetName,
  createResearchSheet,
  appendResearchRows,
  listResearchSheets,
  addCustomColumns,
  sheetExists,
} from "./lib/sheets.mjs";
import { fetchPage } from "./lib/scraper.mjs";
import { searchWebBulk } from "./lib/brave-search.mjs";
import { checkRobots } from "./lib/robots.mjs";
import { Throttle } from "./lib/throttle.mjs";

// ========================================
// CLI
// ========================================

function getArg(name, argv = process.argv) {
  const idx = argv.indexOf(name);
  if (idx === -1) return null;
  return argv[idx + 1] ?? null;
}

function hasFlag(name, argv = process.argv) {
  return argv.includes(name);
}

function parseCsv(str) {
  if (!str) return [];
  return str
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

// ========================================
// サブコマンド実装
// ========================================

/**
 * create-sheet — シート新規作成
 *
 *   --name <名前>          シート名の <名前> 部分(yyyyMMdd_ は自動付与)
 *   --sheet-name <フル名>  日付含むシート名をそのまま指定(--name より優先)
 *   --columns <カンマ区切り>  E列以降のカスタム列名
 */
async function cmdCreateSheet() {
  const nameArg = getArg("--name");
  const fullArg = getArg("--sheet-name");
  const columns = parseCsv(getArg("--columns"));

  const sheetName = fullArg || (nameArg ? buildSheetName(nameArg) : null);
  if (!sheetName) {
    console.error("Error: --name か --sheet-name を指定してください");
    process.exit(1);
  }

  if (await sheetExists(sheetName)) {
    console.log(
      JSON.stringify({
        ok: true,
        sheetName,
        status: "already_exists",
        message: `シート「${sheetName}」は既に存在します(追記モード)`,
      })
    );
    return;
  }

  const res = await createResearchSheet(sheetName, columns);
  console.log(
    JSON.stringify({
      ok: true,
      sheetName: res.sheetName,
      headers: res.headers,
      status: "created",
    })
  );
}

/**
 * inspect-page — 1ページを取得して、何が取れそうかの材料を返す
 *
 * エージェントがこの出力を読んで、取得項目の可否を判断する。
 * ページ構造の概要(見出し、テーブル、リスト要素、JSON-LD、meta等)を返す。
 *
 *   --url <URL>
 *   --mode <auto|static|browser>
 *   --selectors <カンマ区切り>  (optional) ユーザーが欲しい項目のセレクタ候補
 */
async function cmdInspectPage() {
  const url = getArg("--url");
  if (!url) {
    console.error("Error: --url を指定してください");
    process.exit(1);
  }
  const mode = getArg("--mode") || "auto";
  const selectors = parseCsv(getArg("--selectors"));

  const robots = await checkRobots(url);

  const throttle = new Throttle();
  const { $, html, title, finalUrl, mode: actualMode } = await fetchPage(url, {
    mode,
    throttle,
    respectRobots: false, // ここでは警告だけ出して、fetch 自体はする(確認のため)
  });

  // 構造サマリー
  const summary = {
    url: finalUrl,
    title,
    mode: actualMode,
    robots: {
      allowed: robots.allowed,
      rule: robots.rule || null,
      crawlDelay: robots.crawlDelay || null,
    },
    htmlLength: html.length,
    headings: {
      h1: $("h1").map((_, el) => $(el).text().trim()).get().slice(0, 5),
      h2: $("h2").map((_, el) => $(el).text().trim()).get().slice(0, 10),
      h3: $("h3").map((_, el) => $(el).text().trim()).get().slice(0, 10),
    },
    tables: $("table").length,
    lists: {
      ul: $("ul").length,
      ol: $("ol").length,
    },
    links: $("a[href]").length,
    images: $("img").length,
    meta: {
      description: $('meta[name="description"]').attr("content") || null,
      ogTitle: $('meta[property="og:title"]').attr("content") || null,
      ogType: $('meta[property="og:type"]').attr("content") || null,
    },
    jsonLd: extractJsonLd($),
    // 一覧ページっぽさのヒント(クラス名の繰り返し)
    repeatedClasses: findRepeatedClasses($),
  };

  // ユーザー指定セレクタの存在チェック
  if (selectors.length > 0) {
    summary.selectorChecks = selectors.map((sel) => ({
      selector: sel,
      count: $(sel).length,
      sample: $(sel).first().text().trim().slice(0, 200),
    }));
  }

  console.log(JSON.stringify(summary, null, 2));
}

function extractJsonLd($) {
  const scripts = $('script[type="application/ld+json"]');
  const parsed = [];
  scripts.each((_, el) => {
    try {
      const text = $(el).html();
      if (!text) return;
      const data = JSON.parse(text);
      // 大きすぎるものは先頭だけ
      parsed.push({
        type: data["@type"] || null,
        keys: Object.keys(data).slice(0, 20),
      });
    } catch {
      // ignore
    }
  });
  return parsed;
}

/**
 * 同じクラス名が多数繰り返されているものを抽出
 * (一覧ページ/カード型レイアウトの検出に使う)
 */
function findRepeatedClasses($) {
  const counts = new Map();
  $("[class]").each((_, el) => {
    const cls = ($(el).attr("class") || "").trim();
    if (!cls) return;
    // 最も特徴的そうなクラス(最初のトークン)をキーに
    const first = cls.split(/\s+/)[0];
    if (!first) return;
    counts.set(first, (counts.get(first) || 0) + 1);
  });
  return [...counts.entries()]
    .filter(([, n]) => n >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([cls, count]) => ({ class: cls, count }));
}

/**
 * search — Brave Search API
 */
async function cmdSearch() {
  const query = getArg("--query");
  if (!query) {
    console.error("Error: --query を指定してください");
    process.exit(1);
  }
  const maxResults = parseInt(getArg("--max") || "20", 10);
  const country = getArg("--country") || "jp";
  const freshness = getArg("--freshness") || undefined;

  const results = await searchWebBulk(query, { maxResults, country, freshness });
  console.log(JSON.stringify(results, null, 2));
}

/**
 * append-rows — stdin から JSON 配列を読んでシートに追記
 *
 * items 形式:
 *   [{ "title": "...", "url": "...", "extras": { "住所": "..." } }, ...]
 */
async function cmdAppendRows() {
  const sheetName = getArg("--sheet");
  if (!sheetName) {
    console.error("Error: --sheet を指定してください");
    process.exit(1);
  }
  const skipDuplicateUrls = !hasFlag("--allow-dup");

  const raw = await readStdin();
  let items;
  try {
    items = JSON.parse(raw);
  } catch (err) {
    console.error("Error: stdin の JSON パース失敗:", err.message);
    process.exit(1);
  }
  if (!Array.isArray(items)) {
    console.error("Error: stdin は配列でなければなりません");
    process.exit(1);
  }

  // シートに存在しないカスタム列があれば追加
  const extraKeys = new Set();
  for (const it of items) {
    if (it.extras && typeof it.extras === "object") {
      for (const k of Object.keys(it.extras)) extraKeys.add(k);
    }
  }
  if (extraKeys.size > 0) {
    await addCustomColumns(sheetName, [...extraKeys]);
  }

  const res = await appendResearchRows(sheetName, items, { skipDuplicateUrls });
  console.log(JSON.stringify({ ok: true, sheetName, ...res }));
}

/**
 * list-sheets — 既存のリサーチシート一覧
 */
async function cmdListSheets() {
  const sheets = await listResearchSheets();
  console.log(JSON.stringify(sheets, null, 2));
}

// ========================================
// ルーティング
// ========================================

async function main() {
  const cmd = process.argv[2];
  if (!cmd) {
    console.log("Usage:");
    console.log("  node tools/research-helpers.mjs <command> [options]");
    console.log("");
    console.log("Commands:");
    console.log("  create-sheet    --name <名前> [--columns \"col1,col2\"]");
    console.log("  inspect-page    --url <URL> [--mode auto|static|browser] [--selectors \".a,.b\"]");
    console.log("  search          --query <q> [--max 20] [--country jp] [--freshness pd|pw|pm|py]");
    console.log("  append-rows     --sheet <シート名> [--allow-dup]   (stdin に JSON 配列)");
    console.log("  list-sheets");
    process.exit(0);
  }

  const handlers = {
    "create-sheet": cmdCreateSheet,
    "inspect-page": cmdInspectPage,
    search: cmdSearch,
    "append-rows": cmdAppendRows,
    "list-sheets": cmdListSheets,
  };

  const handler = handlers[cmd];
  if (!handler) {
    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
  }
  await handler();
}

main().catch((err) => {
  console.error("Error:", err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
