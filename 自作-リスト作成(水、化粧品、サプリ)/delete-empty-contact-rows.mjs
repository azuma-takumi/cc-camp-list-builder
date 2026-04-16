#!/usr/bin/env node
/**
 * D列（問い合わせ先）が空の行を削除する（1行目がヘッダーの場合は残す）
 *
 * 例: node delete-empty-contact-rows.mjs
 *     node delete-empty-contact-rows.mjs --dry-run
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const TARGET_SHEETS = [
  '1.TVショッピング',
  '2.自社通販',
  '3.Yahoo',
  '4.Rakutenn',
];

function isLikelyHeaderRow(row) {
  const a = String(row?.[0] ?? '').trim();
  const b = String(row?.[1] ?? '').trim();
  if (/^カテゴリ$/i.test(a)) return true;
  if (a === 'category' || b === 'ショップ名' || b === '店舗名') return true;
  return false;
}

function isEmptyContact(d) {
  return !d || String(d).trim() === '';
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const sheetIdByTitle = new Map(meta.data.sheets.map((s) => [s.properties.title, s.properties.sheetId]));

  for (const sheetName of TARGET_SHEETS) {
    const sheetId = sheetIdByTitle.get(sheetName);
    if (sheetId == null) {
      console.log(`[${sheetName}] スキップ（シートなし）`);
      continue;
    }

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:D`,
    });
    const rows = res.data.values || [];
    const toDelete = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (isLikelyHeaderRow(row)) continue;
      const d = (row[3] ?? '').trim();
      if (!isEmptyContact(d)) continue;
      const name = (row[1] ?? '').trim();
      const url = (row[2] ?? '').trim();
      toDelete.push({ i, name, url });
    }

    if (toDelete.length === 0) {
      console.log(`[${sheetName}] D列空欄のデータ行はありません`);
      continue;
    }

    console.log(`[${sheetName}] D列空欄 ${toDelete.length} 行:`);
    for (const { name, url } of toDelete) {
      console.log(`  - ${name || '(無名)'}  ${url || '(URLなし)'}`);
    }

    if (dryRun) {
      console.log(`  （dry-run のため削除していません）\n`);
      continue;
    }

    const indicesDesc = [...toDelete].sort((a, b) => b.i - a.i).map((x) => x.i);
    const requests = indicesDesc.map((idx) => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: idx,
          endIndex: idx + 1,
        },
      },
    }));

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
    console.log(`  ✅ ${toDelete.length} 行削除しました\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
