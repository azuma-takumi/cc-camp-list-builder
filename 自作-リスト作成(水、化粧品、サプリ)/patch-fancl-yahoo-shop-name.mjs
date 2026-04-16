/**
 * 3.Yahoo でファンケル公式店の B列が長文 title のままの行を「FANCL公式ショップ Yahoo店」に短縮（Yahoo は A 列でカテゴリ分けするため B にサプリ等の接尾辞は付けない）
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { shopDisplayNameForYahoo, preventSheetAutoLinkInShopName } from './utils.mjs';
import { ATTACK_SPREADSHEET_ID } from './attack-spreadsheet-config.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEET = '3.Yahoo';
const SHORT = 'FANCL公式ショップ Yahoo店';

function isLongFanclYahooTitle(b) {
  const s = String(b ?? '').trim();
  if (!/FANCL公式ショップ\s*Yahoo店/i.test(s)) return false;
  return s.length > SHORT.length + 2 || /安心安全|サプリメントのご購入|トップページ/i.test(s);
}

async function patchBook(sheets, spreadsheetId, label) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET}'!A:F`,
  });
  const rows = res.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const a = String(row[0] ?? '').trim();
    const b = String(row[1] ?? '');
    if (!isLongFanclYahooTitle(b)) continue;
    const newB = preventSheetAutoLinkInShopName(shopDisplayNameForYahoo(SHORT, a));
    const out = [a, newB, row[2] ?? '', row[3] ?? '', row[4] ?? '', row[5] ?? ''];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET}'!A${i + 1}:F${i + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [out] },
    });
    console.log(`[${label}] 行${i + 1}: B列を短縮 → ${newB}`);
  }
}

async function main() {
  const sheets = await getSheetsClient();
  await patchBook(sheets, getSpreadsheetId(), 'メイン');
  await patchBook(sheets, ATTACK_SPREADSHEET_ID, 'アタック');
  console.log('✅ 完了');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
