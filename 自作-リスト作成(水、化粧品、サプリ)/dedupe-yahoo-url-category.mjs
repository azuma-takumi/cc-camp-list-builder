#!/usr/bin/env node
/**
 * メイン「3.Yahoo」で A列カテゴリ + C列URL が重複している行を、先に出現した行だけ残して削除する
 *
 *   node dedupe-yahoo-url-category.mjs           # dry-run（削除しない）
 *   node dedupe-yahoo-url-category.mjs --apply   # 実際に行削除
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { urlCategoryDuplicateKey } from './utils.mjs';
import { readYahooSheetAllRows } from './yahoo-sheet-rows.mjs';

const SHEET = '3.Yahoo';
const HEADER_ROW = 1;

async function main() {
  const apply = process.argv.includes('--apply');
  const { rows } = await readYahooSheetAllRows(SHEET);

  /** @type {Map<string, number>} キー → 残す行番号 */
  const keyToKeep = new Map();
  /** @type {number[]} 削除する行番号（昇順） */
  const toDelete = [];

  for (let i = 0; i < rows.length; i++) {
    const sheetRow = i + 1;
    if (sheetRow <= HEADER_ROW) continue;
    const cat = String(rows[i][0] ?? '').trim();
    const url = String(rows[i][2] ?? '').trim();
    if (!url) continue;
    const key = urlCategoryDuplicateKey(url, cat);
    if (!key) continue;

    if (!keyToKeep.has(key)) {
      keyToKeep.set(key, sheetRow);
    } else {
      toDelete.push(sheetRow);
    }
  }

  if (toDelete.length === 0) {
    console.log('削除対象の重複行はありません。');
    return;
  }

  console.log(
    apply
      ? `以下 ${toDelete.length} 行を削除します（各キーは先頭行のみ残す）:`
      : `dry-run: 以下 ${toDelete.length} 行を削除予定（--apply で実行）:`
  );
  console.log(toDelete.join(', '));

  if (!apply) return;

  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const sheet = meta.data.sheets.find((s) => s.properties.title === SHEET);
  if (!sheet) throw new Error(`シートが見つかりません: ${SHEET}`);
  const sheetId = sheet.properties.sheetId;

  const sorted = [...toDelete].sort((a, b) => b - a);
  const requests = sorted.map((rowIndex) => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: 'ROWS',
        startIndex: rowIndex - 1,
        endIndex: rowIndex,
      },
    },
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  console.log(`\n✅ ${toDelete.length} 行を削除しました。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
