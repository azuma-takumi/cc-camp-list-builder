/** メディカライズヘルスケア行の A列を「化粧品」に統一 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { normalizeBrandNameKey } from './utils.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEETS = ['1.TVショッピング', '2.自社通販', '3.Yahoo', '4.Rakutenn'];
const KEY = normalizeBrandNameKey('メディカライズヘルスケア');
const CAT = '化粧品';

async function main() {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  for (const sheetName of SHEETS) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:D`,
    });
    const rows = res.data.values || [];
    for (let i = 0; i < rows.length; i++) {
      if (normalizeBrandNameKey(rows[i][1] ?? '') !== KEY) continue;
      const r = i + 1;
      const cur = (rows[i][0] ?? '').trim();
      if (cur === CAT) {
        console.log(`[${sheetName}] 行${r}: すでに ${CAT}`);
        continue;
      }
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!A${r}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[CAT]] },
      });
      console.log(`[${sheetName}] 行${r}: A列「${cur || '(空)'}」→「${CAT}」`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
