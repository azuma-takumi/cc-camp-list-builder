import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { normalizeBrandNameKey, preventSheetAutoLinkInShopName, urlCategoryDuplicateKey } from './utils.mjs';

/** 3.Yahoo の列数（A:カテゴリ B:店名 C:URL D:問合せ E:メール F:収集時の検索クエリ） */
export const YAHOO_SHEET_COL_COUNT = 6;
export const YAHOO_LAST_COL_LETTER = 'F';

/** 4.Rakutenn の列数（E は空またはメール、F:収集時の検索クエリ） */
export const RAKUTEN_SHEET_COL_COUNT = 6;
export const RAKUTEN_LAST_COL_LETTER = 'F';

function sheetColSpec(sheetName) {
  if (sheetName === '3.Yahoo') return { count: YAHOO_SHEET_COL_COUNT, letter: YAHOO_LAST_COL_LETTER };
  if (sheetName === '4.Rakutenn') return { count: RAKUTEN_SHEET_COL_COUNT, letter: RAKUTEN_LAST_COL_LETTER };
  return { count: 4, letter: 'D' };
}

/**
 * シートに行を追記する
 * @param {string} sheetName - シート名 (例: '3.Yahoo')
 * @param {string[][]} rows - 追記するデータ [[カテゴリ, ショップ名, URL, D, …], ...] ※Yahoo/楽天は6列（F=検索クエリ）
 */
export async function appendRows(sheetName, rows) {
  if (rows.length === 0) {
    console.log(`  [${sheetName}] 追記データなし`);
    return;
  }

  const { count: colCount, letter: lastLetter } = sheetColSpec(sheetName);

  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const valuesOut = rows.map((r) => {
    const row = [...r];
    while (row.length < colCount) row.push('');
    if (row.length > colCount) row.length = colCount;
    if (row.length >= 2) row[1] = preventSheetAutoLinkInShopName(row[1]);
    return row;
  });

  // 次行の手計算は「疎な返却」でズレることがあるため、Sheets API の append を使う
  const appendRange = `'${sheetName}'!A:${lastLetter}`;
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: appendRange,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: valuesOut },
  });

  console.log(`✅ [${sheetName}] ${rows.length} 件を追記しました`);
}

/**
 * 既存の (A列カテゴリ + C列URL) キー（Yahoo/楽天で同一店をカテゴリ別に複数行するため）
 * @param {string} sheetName
 * @returns {Set<string>} urlCategoryDuplicateKey 形式
 */
export async function getExistingUrlCategoryKeys(sheetName) {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const { letter: lastLetter } = sheetColSpec(sheetName);
  const range = `'${sheetName}'!A:${lastLetter}`;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    const rows = res.data.values || [];
    const set = new Set();
    for (const row of rows) {
      const cat = String(row[0] ?? '').trim();
      const url = String(row[2] ?? '').trim();
      if (!url) continue;
      set.add(urlCategoryDuplicateKey(url, cat));
    }
    return set;
  } catch {
    return new Set();
  }
}

/**
 * 既存データのURLセットを取得（重複チェック用）
 * @param {string} sheetName
 * @returns {Set<string>}
 */
export async function getExistingUrls(sheetName) {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!C:C`,
    });
    const values = res.data.values || [];
    return new Set(values.flat().filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * 既存データの企業名セット（重複チェック用・B列）
 * @param {string} sheetName
 * @returns {Set<string>} normalizeBrandNameKey 済みのキー
 */
export async function getExistingNames(sheetName) {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!B:B`,
    });
    const values = res.data.values || [];
    const set = new Set();
    for (const row of values) {
      const cell = row[0];
      if (cell == null || String(cell).trim() === '') continue;
      const key = normalizeBrandNameKey(cell);
      if (key) set.add(key);
    }
    return set;
  } catch {
    return new Set();
  }
}
