/**
 * 4.Rakutenn シートの各カテゴリ行について、
 * 楽天ウェブサービス API（shopCode フィルタ）で実際に商品がヒットするか確認し、
 * 0件のショップを報告・削除する。
 *
 * 実行: node verify-rakuten-stores.mjs [--dry-run] [--delete] [--category=カテゴリ名]
 *   --dry-run  : 報告のみ（削除しない）
 *   --delete   : 0件ショップを削除
 *   --category=化粧品  : 特定カテゴリのみ対象
 */

import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { isRakutenWebServiceConfigured, fetchShopItemCountForVerify } from './rakuten-webservice.mjs';
import { delay } from './utils.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEET_NAME = '4.Rakutenn';
const DRY_RUN = process.argv.includes('--dry-run');
const DO_DELETE = process.argv.includes('--delete');

const CATEGORY_VERIFY_QUERY = {
  '化粧品':       '化粧品',
  'サプリメント': 'サプリ',
  'ウォーターサーバー': 'ウォーターサーバー',
};

function getTargetCategory() {
  for (const a of process.argv) {
    if (a.startsWith('--category=')) return a.slice('--category='.length).trim();
  }
  return null; // null = 全カテゴリ
}
const TARGET_CATEGORY = getTargetCategory();

function extractShopCode(url) {
  const m = String(url ?? '').match(/rakuten\.co\.jp\/([a-zA-Z0-9_-]+)\//);
  return m ? m[1] : null;
}

async function main() {
  if (!isRakutenWebServiceConfigured()) {
    console.error('❌ RAKUTEN_APPLICATION_ID が未設定です。.env を確認してください。');
    process.exit(1);
  }

  const mode = DO_DELETE ? '[DELETE]' : DRY_RUN ? '[DRY RUN]' : '[REPORT]';
  const catLabel = TARGET_CATEGORY ? ` カテゴリ:${TARGET_CATEGORY}` : '';
  console.log(`\n🔍 楽天ショップ検証 ${mode}${catLabel}`);

  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A:C`,
  });
  const allRows = res.data.values || [];
  console.log(`  シート総行数: ${allRows.length}`);

  // sheetId 取得（削除時）
  let sheetId = null;
  if (DO_DELETE) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
    const sheet = meta.data.sheets.find(s => s.properties.title === SHEET_NAME);
    if (!sheet) { console.error(`シート "${SHEET_NAME}" が見つかりません`); return; }
    sheetId = sheet.properties.sheetId;
  }

  const categories = TARGET_CATEGORY
    ? [TARGET_CATEGORY]
    : [...new Set(Object.keys(CATEGORY_VERIFY_QUERY))];

  const allZeroRowIndices = [];

  for (const category of categories) {
    const verifyQuery = CATEGORY_VERIFY_QUERY[category];
    if (!verifyQuery) { console.log(`\n  [${category}] 検証クエリ未定義 → スキップ`); continue; }

    const rows = allRows
      .map((row, i) => ({ rowIndex: i, rowNum: i + 1, row }))
      .filter(({ row }) => String(row[0] ?? '').trim() === category);

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`📦 ${category} → 「${verifyQuery}」(${rows.length}件)`);

    let hits = 0;
    const zeros = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const { rowIndex, rowNum, row } = rows[i];
      const shopName = String(row[1] ?? '').trim();
      const shopUrl = String(row[2] ?? '').trim();
      const shopCode = extractShopCode(shopUrl);

      if (!shopCode) {
        errors.push({ rowNum, shopName, shopCode: '(解析不可)' });
        process.stdout.write(`  [${i+1}/${rows.length}] ⚠️  URL解析不可: ${shopName}\n`);
        continue;
      }

      const { count, error } = await fetchShopItemCountForVerify({ shopCode, keyword: verifyQuery });

      if (error) {
        errors.push({ rowNum, shopName, shopCode, reason: error });
        process.stdout.write(`  [${i+1}/${rows.length}] ⚠️  APIエラー: ${shopName} → ${error}\n`);
      } else if (count === 0) {
        zeros.push({ rowIndex, rowNum, shopName, shopCode });
        process.stdout.write(`  [${i+1}/${rows.length}] ❌ 0件: ${shopName} (${shopCode})\n`);
      } else {
        hits++;
        process.stdout.write(`  [${i+1}/${rows.length}] ✅ ${shopName} (${count}件)\r`);
      }

      await delay(300 + Math.random() * 200); // APIレート制限対策
    }

    console.log(`\n\n  ✅ ヒット: ${hits} 件  ❌ 0件: ${zeros.length} 件  ⚠️ エラー: ${errors.length} 件`);
    if (zeros.length > 0) {
      console.log(`\n  0件ショップ:`);
      zeros.forEach(({ rowNum, shopName, shopCode }) =>
        console.log(`    Row${rowNum}: ${shopName} (${shopCode})`)
      );
    }

    zeros.forEach(z => allZeroRowIndices.push(z.rowIndex));
  }

  console.log(`\n${'─'.repeat(50)}`);

  if (allZeroRowIndices.length === 0) {
    console.log('削除対象なし。完了。');
    return;
  }

  if (!DO_DELETE) {
    console.log(`${DRY_RUN ? '[DRY RUN]' : ''} 削除対象: ${allZeroRowIndices.length} 件`);
    console.log('削除するには --delete を付けて実行してください。');
    return;
  }

  // バッチ削除（後ろから）
  const sorted = [...allZeroRowIndices].sort((a, b) => b - a);
  const requests = sorted.map(rowIndex => ({
    deleteDimension: {
      range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 },
    },
  }));
  console.log(`\n🗑️  ${requests.length} 行を削除中...`);
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  console.log(`✅ ${requests.length} 行を削除しました。`);
}

main().catch(console.error);
