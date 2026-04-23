#!/usr/bin/env node

/**
 * run-scraper.mjs — 保存済みスクレイパー(scrapers/*.mjs)を名前で実行
 *
 * Usage:
 *   node tools/run-scraper.mjs <名前>           # 実行
 *   node tools/run-scraper.mjs <名前> --dry-run # 書き込みせずに確認
 *   node tools/run-scraper.mjs --list           # 保存済み一覧
 *   node tools/run-scraper.mjs <名前> --show    # config の内容だけ表示
 */

import { readdirSync, existsSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const SCRAPERS_DIR = join(PROJECT_ROOT, "scrapers");

function hasFlag(name) {
  return process.argv.includes(name);
}

export function listScrapers() {
  if (!existsSync(SCRAPERS_DIR)) return [];
  return readdirSync(SCRAPERS_DIR)
    .filter((f) => f.endsWith(".mjs") && !f.startsWith("_"))
    .map((f) => {
      const full = join(SCRAPERS_DIR, f);
      const stat = statSync(full);
      return {
        name: f.replace(/\.mjs$/, ""),
        fileName: f,
        path: full,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

function resolveScraperPath(name) {
  if (!name) return null;
  const tryNames = [
    `${name}.mjs`,
    name.endsWith(".mjs") ? name : null,
  ].filter(Boolean);
  for (const fn of tryNames) {
    const p = join(SCRAPERS_DIR, fn);
    if (existsSync(p)) return p;
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const firstArg = args.find((a) => !a.startsWith("--")) || null;

  if (hasFlag("--list") || (!firstArg && args.length === 0)) {
    const list = listScrapers();
    if (list.length === 0) {
      console.log("保存済みスクレイパーはありません。");
      console.log("  リサーチ実行後に「スクリプト化して」と言うと保存できます。");
      return;
    }
    console.log("保存済みスクレイパー:");
    for (const s of list) {
      console.log(`  - ${s.name}  (更新: ${s.modifiedAt.slice(0, 16).replace("T", " ")})`);
    }
    console.log("");
    console.log("実行: node tools/run-scraper.mjs <名前> [--dry-run]");
    return;
  }

  const scraperPath = resolveScraperPath(firstArg);
  if (!scraperPath) {
    console.error(`Error: scrapers/${firstArg}.mjs が見つかりません。`);
    console.error("  一覧を見る: node tools/run-scraper.mjs --list");
    process.exit(1);
  }

  const mod = await import(pathToFileURL(scraperPath).href);
  if (!mod.config) {
    console.error(`Error: ${scraperPath} に config export がありません。`);
    process.exit(1);
  }

  if (hasFlag("--show")) {
    console.log(JSON.stringify(mod.config, null, 2));
    return;
  }

  const { runResearch } = await import("./research.mjs");
  const dryRun = hasFlag("--dry-run");

  console.log(`[run-scraper] ${firstArg} を実行${dryRun ? "(dry-run)" : ""}`);
  const result = await runResearch(mod.config, { dryRun });

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
}

main().catch((err) => {
  console.error("Error:", err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
