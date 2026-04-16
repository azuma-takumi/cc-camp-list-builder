/**
 * 「1.TVショッピング」で B=プラセンタワン または C が協和薬品サイトの行を B=協和薬品 に直す
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { normalizeBrandNameKey } from './utils.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const TV_SHEET = '1.TVショッピング';
const OLD_B = 'プラセンタワン';
const NEW_B = '協和薬品';
const URL_HINT = 'kyowa-yakuhin.co.jp';

async function main() {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TV_SHEET}'!A:D`,
  });
  const rows = res.data.values || [];
  const oldKey = normalizeBrandNameKey(OLD_B);

  for (let i = 0; i < rows.length; i++) {
    const b = (rows[i][1] || '').trim();
    const c = (rows[i][2] || '').trim();
    const matchB = normalizeBrandNameKey(b) === oldKey;
    const matchUrl = c.includes(URL_HINT);
    if (!(matchB || matchUrl)) continue;

    const r = i + 1;
    if (normalizeBrandNameKey(b) === normalizeBrandNameKey(NEW_B)) {
      console.log(`行 ${r}: すでに「${NEW_B}」のためスキップ`);
      continue;
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${TV_SHEET}'!B${r}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[NEW_B]] },
    });
    console.log(`行 ${r}: B列を「${b || '(空)'}」→「${NEW_B}」に更新しました`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
