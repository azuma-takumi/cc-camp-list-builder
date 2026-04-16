/**
 * 既存シートの B 列で daily-3.com 等がリンク表示になる行を、先頭 ZWSP 付きのプレーンテキストに直す。
 * メイン SPREADSHEET_ID とアタック ATTACK_SPREADSHEET_ID の両方。
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { preventSheetAutoLinkInShopName } from './utils.mjs';
import { ATTACK_SPREADSHEET_ID } from './attack-spreadsheet-config.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEETS = ['1.TVショッピング', '2.自社通販', '3.Yahoo', '4.Rakutenn'];

async function patchSpreadsheet(sheets, spreadsheetId, label) {
  for (const sheetName of SHEETS) {
    const colEnd = sheetName === '3.Yahoo' || sheetName === '4.Rakutenn' ? 'F' : 'D';
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:${colEnd}`,
    });
    const rows = res.data.values || [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      const b = row[1];
      const fixed = preventSheetAutoLinkInShopName(b);
      if (fixed === b) continue;
      const newRow =
        sheetName === '3.Yahoo' || sheetName === '4.Rakutenn'
          ? [row[0], fixed, row[2], row[3], row[4], row[5]].map((c) => (c == null ? '' : c))
          : [row[0], fixed, row[2], row[3]].map((c) => (c == null ? '' : c));
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!A${i + 1}:${colEnd}${i + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [newRow] },
      });
      console.log(`[${label}][${sheetName}] 行${i + 1} B列: リンク化防止（${String(b).slice(0, 40)}…）`);
    }
  }
}

async function main() {
  const sheets = await getSheetsClient();
  await patchSpreadsheet(sheets, getSpreadsheetId(), 'メイン');
  await patchSpreadsheet(sheets, ATTACK_SPREADSHEET_ID, 'アタック');
  console.log('✅ 完了');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
