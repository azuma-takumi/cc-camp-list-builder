/**
 * 3.Yahoo の A:F を読み、シート行番号（1始まり）と一致させる
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';

const SHEET = '3.Yahoo';

/**
 * @param {string} [sheetName]
 * @returns {Promise<{ endRow: number, rows: string[][] }>} rows[i] = シート行 (i+1) の内容（長さ endRow）
 */
export async function readYahooSheetAllRows(sheetName = SHEET) {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const snap = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!A:F`,
  });
  const dataRange = snap.data.range || '';
  let endRow = 0;
  const m = dataRange.match(/!A1:F(\d+)/i) || dataRange.match(/:F(\d+)/i);
  if (m) endRow = parseInt(m[1], 10);
  else endRow = (snap.data.values || []).length;

  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const sheet = meta.data.sheets.find((s) => s.properties.title === sheetName);
  const gridRows = sheet?.properties?.gridProperties?.rowCount ?? 1000;
  endRow = Math.min(Math.max(endRow, 1), gridRows, 50000);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!A1:F${endRow}`,
    majorDimension: 'ROWS',
  });
  const values = res.data.values || [];
  /** @type {string[][]} */
  const rows = [];
  for (let i = 0; i < endRow; i++) {
    const row = values[i] || [];
    rows.push([
      String(row[0] ?? ''),
      String(row[1] ?? ''),
      String(row[2] ?? ''),
      String(row[3] ?? ''),
      String(row[4] ?? ''),
      String(row[5] ?? ''),
    ]);
  }
  return { endRow, rows };
}
