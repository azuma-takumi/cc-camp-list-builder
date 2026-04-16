#!/usr/bin/env node
/**
 * メイン「3.Yahoo」で A列カテゴリ + C列URL の重複を列挙（行番号付き）
 *
 *   node report-yahoo-url-category-dupes.mjs
 */
import { urlCategoryDuplicateKey } from './utils.mjs';
import { readYahooSheetAllRows } from './yahoo-sheet-rows.mjs';

const HEADER_ROW = 1;

async function main() {
  const { rows } = await readYahooSheetAllRows();
  /** @type {Map<string, number[]>} */
  const keyToRows = new Map();

  for (let i = 0; i < rows.length; i++) {
    const sheetRow = i + 1;
    if (sheetRow <= HEADER_ROW) continue;
    const cat = String(rows[i][0] ?? '').trim();
    const url = String(rows[i][2] ?? '').trim();
    if (!url) continue;
    const key = urlCategoryDuplicateKey(url, cat);
    if (!key) continue;
    if (!keyToRows.has(key)) keyToRows.set(key, []);
    keyToRows.get(key).push(sheetRow);
  }

  const dupes = [...keyToRows.entries()].filter(([, list]) => list.length > 1);
  dupes.sort((a, b) => a[1][0] - b[1][0]);

  if (dupes.length === 0) {
    console.log('重複（A列カテゴリ + C列URL）はありません。');
    return;
  }

  console.log(`重複キー: ${dupes.length} 件\n`);
  for (const [key, lineNums] of dupes) {
    console.log(`  ${key}`);
    console.log(`    行: ${lineNums.join(', ')} (${lineNums.length} 行)\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
