/**
 * 「1.TVショッピング」に ビジュードゥメール の C/D 列を反映（同名行があれば上書き）
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { appendRows } from './sheets.mjs';
import { normalizeBrandNameKey } from './utils.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const TV_SHEET = '1.TVショッピング';
const NAME = 'ビジュードゥメール';
const CATEGORY = '化粧品';
const C_URL = 'https://www.shopch.jp/pc/tv/programlist/brand?brandCode=11001&searchType=3&latestPgmPage=1&latestPgmStartDaytime=20260422151000&il=Search_HeaderLink&ic=programtab#noscroll';
const D_CONTACT = 'https://www.shopch.jp/InquiryInit.do?il=Footer&ic=contact';

async function main() {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const key = normalizeBrandNameKey(NAME);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TV_SHEET}'!A:D`,
  });
  const rows = res.data.values || [];
  let rowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (normalizeBrandNameKey(rows[i][1] || '') === key) {
      rowIndex = i;
      break;
    }
  }

  if (rowIndex >= 0) {
    const r = rowIndex + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${TV_SHEET}'!A${r}:D${r}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[CATEGORY, NAME, C_URL, D_CONTACT]] },
    });
    console.log(`更新しました: 行 ${r}（${NAME}）`);
  } else {
    await appendRows(TV_SHEET, [[CATEGORY, NAME, C_URL, D_CONTACT]]);
    console.log(`追記しました: ${NAME}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
