/**
 * 3.Yahoo で store ID kom-kom の B列が文字化け・長文 title のとき「kom-kom」を基準に表示名へ直す。
 * メイン・アタック両方。
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
const STORE_ID = 'kom-kom';
const BASE_NAME = 'kom-kom';

function rowHasKomKomStore(row) {
  const c = String(row[2] ?? '');
  return /store\.shopping\.yahoo\.co\.jp\/kom-kom\b/i.test(c);
}

async function patchBook(sheets, spreadsheetId, label) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET}'!A:F`,
  });
  const rows = res.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!rowHasKomKomStore(row)) continue;
    const a = String(row[0] ?? '').trim();
    const b = String(row[1] ?? '');
    const newB = preventSheetAutoLinkInShopName(shopDisplayNameForYahoo(BASE_NAME, a));
    const bNorm = b.replace(/\u200b/g, '').trim();
    const newNorm = newB.replace(/\u200b/g, '').trim();
    if (bNorm === newNorm) continue;
    const out = [a, newB, row[2] ?? '', row[3] ?? '', row[4] ?? '', row[5] ?? ''];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET}'!A${i + 1}:F${i + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [out] },
    });
    console.log(`[${label}] 行${i + 1}: B列「${String(b).slice(0, 50)}…」→ ${newB}`);
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
