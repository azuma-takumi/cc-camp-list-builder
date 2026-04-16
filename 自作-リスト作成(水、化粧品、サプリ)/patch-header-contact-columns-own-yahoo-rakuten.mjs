#!/usr/bin/env node
/**
 * 「1.TVショッピング」「2.自社通販」「3.Yahoo」「4.Rakutenn」で D・E 列見出しを統一する。
 * メイン: 1行目。アタックリスト: 2行目（1行目は別用途のため）。
 * A〜C は現状のまま。D=問合せフォーム、E=メアド
 * 「3.Yahoo」「4.Rakutenn」は F=検索クエリ（収集時にヒットしたキーワード）
 *
 *   node patch-header-contact-columns-own-yahoo-rakuten.mjs
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { ATTACK_SPREADSHEET_ID } from './attack-spreadsheet-config.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEETS = ['1.TVショッピング', '2.自社通販', '3.Yahoo', '4.Rakutenn'];
const D_HEADER = '問合せフォーム';
const E_HEADER = 'メアド';
const F_HEADER_QUERY = '検索クエリ';

/**
 * @param {number} headerRow - メインは 1、アタックは 2
 */
async function patchHeaders(sheets, spreadsheetId, label, headerRow) {
  const r = `${headerRow}`;

  for (const sheetName of SHEETS) {
    if (sheetName === '3.Yahoo' || sheetName === '4.Rakutenn') {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!A${r}:F${r}`,
      });
      const row = res.data.values?.[0] || [];
      const newRow = [
        row[0] == null ? '' : String(row[0]),
        row[1] == null ? '' : String(row[1]),
        row[2] == null ? '' : String(row[2]),
        D_HEADER,
        E_HEADER,
        F_HEADER_QUERY,
      ];
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!A${r}:F${r}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [newRow] },
      });
      console.log(
        `✅ [${label}] ${sheetName} ${headerRow}行目: D列=${D_HEADER} E列=${E_HEADER} F列=${F_HEADER_QUERY}`
      );
      continue;
    }

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A${r}:E${r}`,
    });
    const row = res.data.values?.[0] || [];
    const newRow = [
      row[0] == null ? '' : String(row[0]),
      row[1] == null ? '' : String(row[1]),
      row[2] == null ? '' : String(row[2]),
      D_HEADER,
      E_HEADER,
    ];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A${r}:E${r}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newRow] },
    });
    console.log(`✅ [${label}] ${sheetName} ${headerRow}行目: D列=${D_HEADER} E列=${E_HEADER}`);
  }
}

async function main() {
  const sheets = await getSheetsClient();
  await patchHeaders(sheets, getSpreadsheetId(), 'メイン', 1);
  await patchHeaders(sheets, ATTACK_SPREADSHEET_ID, 'アタック', 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
