#!/usr/bin/env node

/**
 * init-spreadsheet.mjs — スプレッドシートの接続確認・ID保存
 *
 * --id オプションでスプレッドシートIDを .env に書き込む。
 * SPREADSHEET_ID が設定済みの場合は接続テストを行う。
 *
 * Usage:
 *   node tools/init-spreadsheet.mjs              # 状態確認
 *   node tools/init-spreadsheet.mjs --id XXXXX   # IDを .env に保存して接続テスト
 */

import {
  getSheets,
  SPREADSHEET_ID,
  saveSpreadsheetId,
  listResearchSheets,
} from "./lib/sheets.mjs";

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

function extractIdFromUrl(input) {
  const match = input.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : input;
}

async function main() {
  const idArg = getArg("--id");

  if (idArg) {
    const newId = extractIdFromUrl(idArg);
    saveSpreadsheetId(newId);
    console.log(`✓ SPREADSHEET_ID を .env に保存しました: ${newId}`);
    console.log("");
  }

  const id = idArg ? extractIdFromUrl(idArg) : SPREADSHEET_ID;

  if (!id) {
    console.log("SPREADSHEET_ID が未設定です。");
    console.log("");
    console.log("新しいスプシを作成するには:");
    console.log("  node tools/create-template-sheet.mjs");
    console.log("");
    console.log("既存のスプシに接続するには:");
    console.log("  node tools/init-spreadsheet.mjs --id <スプレッドシートの URL または ID>");
    process.exit(0);
  }

  const sheets = await getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const sheetNames = meta.data.sheets.map((s) => s.properties.title);
  const researchSheets = await listResearchSheets();

  console.log(`✓ 接続OK`);
  console.log(`  URL: https://docs.google.com/spreadsheets/d/${id}`);
  console.log(`  全シート数: ${sheetNames.length}`);
  if (researchSheets.length > 0) {
    console.log(`  リサーチシート(yyyyMMdd_ プレフィックス): ${researchSheets.length}件`);
    researchSheets.slice(0, 10).forEach((n) => console.log(`    - ${n}`));
    if (researchSheets.length > 10) {
      console.log(`    ... 他 ${researchSheets.length - 10} 件`);
    }
  } else {
    console.log(`  リサーチシート: まだありません`);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
