#!/usr/bin/env node
/**
 * メイン・アタックの各タブで、セル内の HTML 実体参照（&amp; → & 等）を一括で表示用文字に直す。
 *   node patch-html-entities-sheets.mjs
 *   node patch-html-entities-sheets.mjs --dry-run
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { decodeHtmlEntitiesForSheetCell, preventSheetAutoLinkInShopName } from './utils.mjs';
import { ATTACK_SPREADSHEET_ID } from './attack-spreadsheet-config.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEETS = ['1.TVショッピング', '2.自社通販', '3.Yahoo', '4.Rakutenn'];

function isLikelyHeaderRow(row) {
  const a = String(row?.[0] ?? '').trim();
  const b = String(row?.[1] ?? '').trim();
  if (/^カテゴリ$/i.test(a)) return true;
  if (a === 'category' || b === 'ショップ名' || b === '店舗名') return true;
  return false;
}

function fixRow(row, colCount) {
  const padded = [...(row || [])];
  while (padded.length < colCount) padded.push('');
  if (padded.length > colCount) padded.length = colCount;
  return padded.map((c, i) => {
    let v = decodeHtmlEntitiesForSheetCell(c);
    if (i === 1) v = preventSheetAutoLinkInShopName(v);
    return v == null ? '' : String(v);
  });
}

function rowNeedsWrite(before, after) {
  for (let i = 0; i < before.length; i++) {
    if (String(before[i] ?? '') !== String(after[i] ?? '')) return true;
  }
  return false;
}

async function patchBook(sheets, spreadsheetId, label, dryRun) {
  for (const sheetName of SHEETS) {
    const isSixCol = sheetName === '3.Yahoo' || sheetName === '4.Rakutenn';
    const colEnd = isSixCol ? 'F' : 'D';
    const colCount = isSixCol ? 6 : 4;

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:${colEnd}`,
    });
    const rows = res.data.values || [];
    const updates = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      if (isLikelyHeaderRow(row)) continue;

      const padded = [...row];
      while (padded.length < colCount) padded.push('');
      if (padded.length > colCount) padded.length = colCount;

      const after = fixRow(padded, colCount);
      if (!rowNeedsWrite(padded, after)) continue;

      updates.push({ rowNum: i + 1, values: after });
    }

    if (updates.length === 0) {
      console.log(`[${label}][${sheetName}] 変更なし`);
      continue;
    }

    console.log(`[${label}][${sheetName}] ${updates.length} 行を更新`);
    for (const u of updates.slice(0, 15)) {
      const b0 = String(rows[u.rowNum - 1]?.[1] ?? '').slice(0, 50);
      const b1 = String(u.values[1] ?? '').slice(0, 50);
      if (b0 !== b1) console.log(`  行${u.rowNum} B: ${b0} → ${b1}`);
    }
    if (updates.length > 15) console.log(`  … 他 ${updates.length - 15} 行`);

    if (!dryRun) {
      const CHUNK = 80;
      for (let c = 0; c < updates.length; c += CHUNK) {
        const slice = updates.slice(c, c + CHUNK);
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: slice.map((u) => ({
              range: `'${sheetName}'!A${u.rowNum}:${colEnd}${u.rowNum}`,
              values: [u.values],
            })),
          },
        });
      }
    }
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const sheets = await getSheetsClient();
  await patchBook(sheets, getSpreadsheetId(), 'メイン', dryRun);
  await patchBook(sheets, ATTACK_SPREADSHEET_ID, 'アタック', dryRun);
  console.log(dryRun ? 'dry-run 終了（--dry-run のため未書き込み）' : '✅ 完了');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
