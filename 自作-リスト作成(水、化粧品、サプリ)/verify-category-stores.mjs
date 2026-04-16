/**
 * 3.Yahoo シートの指定カテゴリのストアについて、
 * ストア内検索（search.html?p=キーワード）で0件のストアを報告する。
 * （削除はしない）
 *
 * 実行: node verify-category-stores.mjs [--start-row=N] [--delete]
 *   --delete : 0件ストアをシートから削除する
 */

import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { fetchHtml, delay } from './utils.mjs';
import { writeLatestSummary } from './summary-writer.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEET_NAME = '3.Yahoo';

const CHECKS = [
  { category: '化粧品',     query: '化粧品' },
  { category: 'サプリメント', query: 'サプリ' },
];

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
const DO_DELETE = process.argv.includes('--delete');

function extractStoreId(url) {
  const m = String(url ?? '').match(/store\.shopping\.yahoo\.co\.jp\/([a-zA-Z0-9_-]+)\//);
  return m ? m[1] : null;
}

/**
 * ストア内検索でヒットするか確認
 * @returns {'hit'|'zero'|'error'|'blocked'}
 */
async function checkStoreSearch(storeId, query) {
  const url = `https://store.shopping.yahoo.co.jp/${storeId}/search.html?p=${encodeURIComponent(query)}`;
  try {
    const html = await fetchHtml(url);
    if (/見つかりません/.test(html)) return 'zero';
    return 'hit';
  } catch (err) {
    const msg = String(err?.message ?? '');
    if (msg.includes('489') || msg.includes('429')) return 'blocked';
    if (msg.includes('404')) return 'zero'; // ストア自体が存在しない
    return 'error';
  }
}

async function deleteRows(sheets, spreadsheetId, sheetId, rowIndices) {
  if (rowIndices.length === 0) return;
  // 後ろから削除（インデックスずれ防止）
  const sorted = [...rowIndices].sort((a, b) => b - a);
  const requests = sorted.map(rowIndex => ({
    deleteDimension: {
      range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 },
    },
  }));
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

async function main() {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // sheetId を先に取得（削除時に必要）
  let sheetId = null;
  if (DO_DELETE) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
    const sheet = meta.data.sheets.find(s => s.properties.title === SHEET_NAME);
    if (!sheet) { console.error(`シート "${SHEET_NAME}" が見つかりません`); return; }
    sheetId = sheet.properties.sheetId;
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A:C`,
  });
  const allRows = res.data.values || [];

  // カテゴリをまたいで削除するので全カテゴリ分の rowIndex を収集してから一括削除
  const allZeroRowIndices = [];
  const summarySections = [];
  let totalHits = 0;
  let totalZeros = 0;
  let totalErrors = 0;

  for (const { category, query } of CHECKS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📦 ${category} → ストア内検索「${query}」`);

    const rows = allRows
      .map((row, i) => ({ rowNum: i + 1, rowIndex: i, row }))
      .filter(({ rowNum, row }) => rowNum >= START_ROW && String(row[0] ?? '').trim() === category);

    console.log(`  対象: ${rows.length} 件\n`);

    const zeros = [];
    const errors = [];
    let hits = 0;

    for (let i = 0; i < rows.length; i++) {
      const { rowNum, rowIndex, row } = rows[i];
      const storeName = String(row[1] ?? '').trim();
      const storeUrl = String(row[2] ?? '').trim();
      const storeId = extractStoreId(storeUrl);

      if (!storeId) {
        errors.push({ rowNum, storeName, storeId: '(解析不可)', reason: 'URL解析不可' });
        process.stdout.write(`  [${i+1}/${rows.length}] ⚠️  URL解析不可: ${storeName}\n`);
        continue;
      }

      const result = await checkStoreSearch(storeId, query);

      if (result === 'hit') {
        hits++;
        process.stdout.write(`  [${i+1}/${rows.length}] ✅ ${storeName}\r`);
      } else if (result === 'zero') {
        zeros.push({ rowNum, rowIndex, storeName, storeId });
        process.stdout.write(`  [${i+1}/${rows.length}] ❌ 0件: ${storeName} (${storeId})\n`);
      } else {
        errors.push({ rowNum, storeName, storeId, reason: result });
        process.stdout.write(`  [${i+1}/${rows.length}] ⚠️  ${result}: ${storeName} (${storeId})\n`);
      }

      await delay(700 + Math.random() * 500);
    }

    console.log(`\n\n── 結果 ──`);
    console.log(`  ✅ ヒットあり: ${hits} 件`);
    console.log(`  ❌ 0件（削除候補）: ${zeros.length} 件`);
    console.log(`  ⚠️  取得失敗: ${errors.length} 件`);

    if (zeros.length > 0) {
      console.log(`\n  0件ストア一覧:`);
      zeros.forEach(({ rowNum, storeName, storeId }) => {
        console.log(`    Row${rowNum}: ${storeName} (${storeId})`);
      });
    }

    // 削除対象 rowIndex を蓄積
    zeros.forEach(z => allZeroRowIndices.push(z.rowIndex));
    totalHits += hits;
    totalZeros += zeros.length;
    totalErrors += errors.length;
    summarySections.push({
      heading: `${category}の確認結果`,
      lines: [
        `- ヒットあり: ${hits}件`,
        `- 0件: ${zeros.length}件`,
        `- 取得失敗: ${errors.length}件`,
        ...(zeros.length > 0 ? zeros.slice(0, 10).map(({ rowNum, storeName, storeId }) => `- Row${rowNum}: ${storeName} (${storeId})`) : ['- 0件候補なし']),
      ],
    });
  }

  console.log(`\n${'='.repeat(60)}`);

  if (!DO_DELETE) {
    writeLatestSummary({
      title: 'カテゴリ検証サマリー',
      overview: [
        { label: '対象タブ', value: SHEET_NAME },
        { label: '開始行', value: START_ROW },
        { label: '削除実行', value: 'なし' },
      ],
      metrics: [
        { label: 'ヒット件数', value: `${totalHits}件` },
        { label: '0件候補', value: `${totalZeros}件` },
        { label: '取得失敗', value: `${totalErrors}件` },
      ],
      sections: summarySections,
    });
    console.log('完了（削除はしていません）');
    return;
  }

  if (allZeroRowIndices.length === 0) {
    console.log('削除対象なし。完了。');
    return;
  }

  console.log(`\n🗑️  合計 ${allZeroRowIndices.length} 行を削除中...`);
  await deleteRows(sheets, spreadsheetId, sheetId, allZeroRowIndices);
  console.log(`✅ ${allZeroRowIndices.length} 行を削除しました。`);
  writeLatestSummary({
    title: 'カテゴリ検証サマリー',
    overview: [
      { label: '対象タブ', value: SHEET_NAME },
      { label: '開始行', value: START_ROW },
      { label: '削除実行', value: 'あり' },
    ],
    metrics: [
      { label: 'ヒット件数', value: `${totalHits}件` },
      { label: '0件候補', value: `${totalZeros}件` },
      { label: '取得失敗', value: `${totalErrors}件` },
      { label: '削除件数', value: `${allZeroRowIndices.length}件` },
    ],
    sections: summarySections,
  });
}

main().catch(console.error);
