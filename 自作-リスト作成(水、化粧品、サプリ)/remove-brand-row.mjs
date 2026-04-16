/**
 * B列が一致する行を削除（TV〜楽天の4シート）
 * 例: node remove-brand-row.mjs ジャパネットウォーター
 * メイン SPREADSHEET_ID に加え、アタックリスト（ATTACK_SPREADSHEET_ID）の同名タブからも削除します。
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { normalizeBrandNameKey } from './utils.mjs';
import { ATTACK_SPREADSHEET_ID } from './attack-spreadsheet-config.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEETS = [
  '1.TVショッピング',
  '2.自社通販',
  '3.Yahoo',
  '4.Rakutenn',
];

async function deleteRow(sheets, spreadsheetId, sheetName, rowIndex0) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const sheet = meta.data.sheets.find((s) => s.properties.title === sheetName);
  if (!sheet) return false;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: sheet.properties.sheetId,
            dimension: 'ROWS',
            startIndex: rowIndex0,
            endIndex: rowIndex0 + 1,
          },
        },
      }],
    },
  });
  return true;
}

async function main() {
  const rawName = (process.argv[2] || 'ジャパネットウォーター').trim();
  if (!rawName) {
    console.error('使い方: node remove-brand-row.mjs ブランド名');
    process.exit(1);
  }
  const key = normalizeBrandNameKey(rawName);

  const sheets = await getSheetsClient();
  const mainId = getSpreadsheetId();

  for (const label of ['メイン', 'アタック']) {
    const spreadsheetId = label === 'メイン' ? mainId : ATTACK_SPREADSHEET_ID;
    for (const sheetName of SHEETS) {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!B:B`,
      });
      const values = res.data.values || [];
      let rowIndex = -1;
      for (let i = 0; i < values.length; i++) {
        if (normalizeBrandNameKey(values[i]?.[0] || '') === key) {
          rowIndex = i;
          break;
        }
      }
      if (rowIndex === -1) {
        console.log(`[${label}][${sheetName}] 「${rawName}」は見つかりません`);
        continue;
      }
      console.log(`[${label}][${sheetName}] 行 ${rowIndex + 1} を削除します`);
      await deleteRow(sheets, spreadsheetId, sheetName, rowIndex);
      console.log(`  ✅ 削除しました`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
