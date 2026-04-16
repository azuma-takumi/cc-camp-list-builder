/**
 * 3.Yahoo シートの「ウォーターサーバー」カテゴリのストアについて、
 * Yahoo!ショッピングのメイン検索（ウォーターサーバー）で実際に商品がヒットするか確認し、
 * 一度もヒットしなかったストアをシートから削除する。
 *
 * ─ 方法 ─
 *  1. Yahoo!ショッピング検索（n=60, 複数ページ）でストアIDを収集
 *  2. シートのウォーターサーバー行のストアIDと照合
 *  3. ヒットしたストア → 保持、ヒットなし → 削除候補
 *
 * 実行: node verify-water-server-stores.mjs [--dry-run] [--start-row=N] [--pages=N]
 *   --dry-run     : 削除対象を表示するだけ（実際には削除しない）
 *   --start-row=N : シートの N 行目以降（1-based）のみを対象にする
 *   --pages=N     : 検索ページ数（デフォルト30, 1ページ=60件）
 */

import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { fetchHtml, delay } from './utils.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEET_NAME = '3.Yahoo';
const TARGET_CATEGORY = 'ウォーターサーバー';
const DRY_RUN = process.argv.includes('--dry-run');

function getArgN(prefix, defaultVal) {
  for (const a of process.argv) {
    if (a.startsWith(prefix)) {
      const n = Number(a.slice(prefix.length));
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
  }
  return defaultVal;
}
const START_ROW = getArgN('--start-row=', 1);
const MAX_PAGES = getArgN('--pages=', 30);
const ITEMS_PER_PAGE = 60;

/** store URL から store_id を抽出 */
function extractStoreId(url) {
  const m = String(url ?? '').match(/store\.shopping\.yahoo\.co\.jp\/([a-zA-Z0-9_-]+)\//);
  return m ? m[1] : null;
}

/** 検索結果HTML から store_id の Set を返す */
function extractStoreIdsFromSearch(html) {
  const ids = new Set();
  const re = /store\.shopping\.yahoo\.co\.jp\/([a-zA-Z0-9_-]+)\//g;
  let m;
  while ((m = re.exec(html)) !== null) {
    ids.add(m[1]);
  }
  return ids;
}

/** Yahoo!ショッピング検索で ウォーターサーバー を販売しているストアIDを収集 */
async function collectWaterServerStoreIds(maxPages) {
  console.log(`\n  Yahoo!ショッピング検索でウォーターサーバー販売ストアを収集中（最大${maxPages}ページ）...`);
  const allIds = new Set();

  for (let page = 1; page <= maxPages; page++) {
    const b = (page - 1) * ITEMS_PER_PAGE + 1;
    const url = `https://shopping.yahoo.co.jp/search?p=${encodeURIComponent('ウォーターサーバー')}&tab_ex=commerce&n=${ITEMS_PER_PAGE}&b=${b}`;

    let html;
    try {
      html = await fetchHtml(url);
    } catch (err) {
      console.warn(`    ⚠️  ページ${page}取得失敗: ${err.message}`);
      break;
    }

    const ids = extractStoreIdsFromSearch(html);
    if (ids.size === 0) {
      console.log(`    ページ${page}: 結果なし（終了）`);
      break;
    }

    const prevSize = allIds.size;
    ids.forEach(id => allIds.add(id));
    const newCount = allIds.size - prevSize;
    process.stdout.write(`    ページ${page}: +${newCount}ストア（累計 ${allIds.size}）\r`);

    await delay(800 + Math.random() * 600);
  }
  console.log(`\n  検索収集完了: ${allIds.size} ユニークストアID`);
  return allIds;
}

async function main() {
  const startLabel = START_ROW > 1 ? ` (Row${START_ROW}〜)` : '';
  console.log(`\n🔍 ${TARGET_CATEGORY} ストア検証${DRY_RUN ? ' [DRY RUN]' : ''}${startLabel}`);

  // ① Yahoo Shopping から水サーバー取扱ストアIDを収集
  const verifiedIds = await collectWaterServerStoreIds(MAX_PAGES);

  // ② シート全行取得
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A:F`,
  });
  const allRows = res.data.values || [];
  console.log(`  シート総行数: ${allRows.length}`);

  // ③ ウォーターサーバーカテゴリ行を抽出
  const waterRows = [];
  for (let i = 0; i < allRows.length; i++) {
    const rowNum = i + 1;
    if (rowNum < START_ROW) continue;
    const row = allRows[i];
    if (String(row[0] ?? '').trim() === TARGET_CATEGORY) {
      waterRows.push({ rowIndex: i, rowNum, row });
    }
  }
  console.log(`  ${TARGET_CATEGORY} カテゴリ行数: ${waterRows.length}${startLabel}`);

  // ④ 照合
  const toDelete = [];
  const verified = [];
  const unknown = []; // store_id が取れなかった行

  for (const { rowIndex, rowNum, row } of waterRows) {
    const storeName = String(row[1] ?? '').trim();
    const storeUrl = String(row[2] ?? '').trim();
    const storeId = extractStoreId(storeUrl);

    if (!storeId) {
      unknown.push({ rowNum, storeName, storeUrl });
      continue;
    }

    if (verifiedIds.has(storeId)) {
      verified.push({ rowNum, storeName, storeId });
    } else {
      toDelete.push({ rowIndex, rowNum, storeId, storeName, storeUrl });
    }
  }

  console.log(`\n── 照合結果 ──`);
  console.log(`  ✅ 検索ヒット（保持）: ${verified.length} 件`);
  console.log(`  ❌ 未ヒット（削除候補）: ${toDelete.length} 件`);
  if (unknown.length > 0) console.log(`  ⚠️  URL解析不可（保留）: ${unknown.length} 件`);

  if (toDelete.length > 0) {
    console.log('\n削除候補ストア:');
    toDelete.forEach(({ rowNum, storeName, storeId }) => {
      console.log(`  Row${rowNum}: ${storeName} (${storeId})`);
    });
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] 削除はスキップ。実際に削除するには --dry-run を外してください。');
    return;
  }

  if (toDelete.length === 0) {
    console.log('\n削除対象なし。完了。');
    return;
  }

  // sheetId 取得
  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const sheet = meta.data.sheets.find(s => s.properties.title === SHEET_NAME);
  if (!sheet) { console.error(`シート "${SHEET_NAME}" が見つかりません`); return; }
  const sheetId = sheet.properties.sheetId;

  // ⑤ 後ろから削除（インデックスずれ防止）
  toDelete.sort((a, b) => b.rowIndex - a.rowIndex);
  console.log(`\n🗑️  ${toDelete.length} 行を一括削除中...`);

  const deleteRequests = toDelete.map(({ rowIndex }) => ({
    deleteDimension: {
      range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 },
    },
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: deleteRequests },
  });

  console.log(`✅ ${toDelete.length} 行を削除しました。`);
}

main().catch(console.error);
