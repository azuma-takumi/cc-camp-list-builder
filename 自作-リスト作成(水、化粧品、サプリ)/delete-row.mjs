/**
 * 指定URLの行をシートから削除する
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEET_NAME = '2.自社通販';
const TARGET_URL  = 'https://www.b-glen.com/';

async function main() {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!C:C`,
  });
  const urls = (res.data.values || []).flat();
  const rowIndex = urls.indexOf(TARGET_URL); // 0-based
  if (rowIndex === -1) {
    console.log('対象URLが見つかりません:', TARGET_URL);
    return;
  }
  const rowNum = rowIndex + 1; // 1-based
  console.log(`Row ${rowNum} を削除します: ${TARGET_URL}`);

  // sheetId を取得
  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const sheet = meta.data.sheets.find(s => s.properties.title === SHEET_NAME);
  if (!sheet) { console.log('シートが見つかりません'); return; }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: sheet.properties.sheetId,
            dimension: 'ROWS',
            startIndex: rowIndex,  // 0-based
            endIndex:   rowIndex + 1,
          },
        },
      }],
    },
  });
  console.log('✅ 削除完了');
}

main().catch(console.error);
