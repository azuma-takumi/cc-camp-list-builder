/**
 * 1シート内で B列ブランドが重複している行を、先頭の1行だけ残して削除する
 * 例: node dedupe-brand-within-sheet.mjs "2.自社通販" "エーザイ"
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { normalizeBrandNameKey } from './utils.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

function isLikelyHeaderRow(row) {
  const a = String(row?.[0] ?? '').trim();
  const b = String(row?.[1] ?? '').trim();
  if (/^カテゴリ$/i.test(a)) return true;
  if (a === 'category' || b === 'ショップ名' || b === '店舗名') return true;
  return false;
}

async function main() {
  const sheetName = process.argv[2] || '2.自社通販';
  const brandArg = process.argv[3] || 'エーザイ';
  const targetKey = normalizeBrandNameKey(brandArg);

  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const sheetId = meta.data.sheets.find((s) => s.properties.title === sheetName)?.properties.sheetId;
  if (sheetId == null) throw new Error(`シートが見つかりません: ${sheetName}`);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!A:D`,
  });
  const rows = res.data.values || [];

  const hitIdx = [];
  for (let i = 0; i < rows.length; i++) {
    if (isLikelyHeaderRow(rows[i])) continue;
    const k = normalizeBrandNameKey(rows[i]?.[1] ?? '');
    if (k === targetKey) hitIdx.push(i);
  }

  if (hitIdx.length <= 1) {
    console.log(`「${brandArg}」の重複なし（${hitIdx.length}行）`);
    return;
  }

  const drop = hitIdx.slice(1);
  const desc = [...drop].sort((a, b) => b - a);
  const requests = desc.map((idx) => ({
    deleteDimension: {
      range: { sheetId, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 },
    },
  }));
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

  console.log(
    `[${sheetName}] 「${brandArg}」重複 ${hitIdx.length} 行中、先頭（行${hitIdx[0] + 1}）のみ残し ${drop.length} 行削除しました（削除行 1-based: ${drop.map((i) => i + 1).join(', ')}）`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
