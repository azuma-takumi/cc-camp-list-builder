/**
 * 1.TVショッピングシートの全行を表示してURL検証する
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEET_NAME = '1.TVショッピング';

// 明らかに間違えているURL（完全に関係ない会社のサイト）
const BAD_URLS = new Set([
  'https://ibas.finance.gov.bd/',          // バングラデシュ政府財務
  'https://www.weforum.org/',              // 世界経済フォーラム
  'https://kotobank.jp/',                  // コトバンク（辞典）
  'https://expy.jp/',                      // JR東日本Suica
  'https://ja.hinative.com/',             // 語学学習サービス
  'https://footystats.org/',              // サッカー統計
  'https://www.academia-music.com/',      // 楽器店
  'https://domani.shogakukan.co.jp/',     // 小学館女性誌
  'https://store.world.co.jp/',           // ワールドファッション
  'https://jpallet.com/',                 // J-Pallet（問屋？）
  'https://www.shiffon-online.jp/',       // シフォン（別ブランド）
]);

async function main() {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A:D`,
  });
  const rows = res.data.values || [];
  console.log(`\n=== 1.TVショッピング 全行 (${rows.length}行) ===`);
  rows.forEach((r, i) => {
    const isBad = BAD_URLS.has(r[2]);
    const mark = isBad ? '❌' : '✅';
    console.log(`Row ${i+1}: ${mark} [${r[0]}] ${r[1]} | ${r[2]} | ${(r[3]||'').slice(0,50)}`);
  });

  // 削除対象行（BAD_URLs に一致）
  const toDelete = rows
    .map((r, i) => ({ idx: i, url: r[2], name: r[1] }))
    .filter(r => BAD_URLS.has(r.url));

  console.log(`\n削除対象: ${toDelete.length}件`);
  toDelete.forEach(r => console.log(`  Row ${r.idx+1}: ${r.name} → ${r.url}`));

  if (toDelete.length === 0) { console.log('削除なし'); return; }

  // sheetId取得
  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const sheet = meta.data.sheets.find(s => s.properties.title === SHEET_NAME);

  // 後ろから削除（インデックスがズレないよう）
  const sortedDesc = [...toDelete].sort((a,b) => b.idx - a.idx);
  for (const { idx, name } of sortedDesc) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: sheet.properties.sheetId,
              dimension: 'ROWS',
              startIndex: idx,
              endIndex: idx + 1,
            },
          },
        }],
      },
    });
    console.log(`✅ 削除: ${name}`);
  }

  console.log('\n削除完了');
}

main().catch(console.error);
