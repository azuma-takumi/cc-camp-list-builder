#!/usr/bin/env node
/**
 * B列（企業名）が複数シートにまたがって重複しているとき、優先度の高いシートの1行だけ残し他を削除する。
 *
 * 優先度（小さいほど残す）: 1.TVショッピング > 2.自社通販 > 3.Yahoo > 4.Rakutenn
 * 例: TVと自社に同じブランドがある → TVの行を残し、自社の行を削除。
 *
 * 単体実行: node dedupe-sheets-by-brand-priority.mjs  /  npm run dedupe
 */
import { fileURLToPath } from 'url';
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { normalizeBrandNameKey } from './utils.mjs';

export const SHEET_PRIORITY = [
  '1.TVショッピング',
  '2.自社通販',
  '3.Yahoo',
  '4.Rakutenn',
];

function isLikelyHeaderRow(row) {
  const a = String(row?.[0] ?? '').trim();
  const b = String(row?.[1] ?? '').trim();
  if (/^カテゴリ$/i.test(a)) return true;
  if (a === 'category' || b === 'ショップ名' || b === '店舗名') return true;
  return false;
}

function sheetPriorityIndex(sheetName) {
  const i = SHEET_PRIORITY.indexOf(sheetName);
  return i === -1 ? 999 : i;
}

function uniqueSortedDesc(nums) {
  return [...new Set(nums)].sort((a, b) => b - a);
}

/**
 * @param {{ log?: (msg: string) => void }} opts
 */
export async function dedupeSheetsByBrandPriority(opts = {}) {
  const logFn = opts.log || ((m) => console.log(m));
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const sheetIdByTitle = new Map(meta.data.sheets.map((s) => [s.properties.title, s.properties.sheetId]));

  /** @type {Map<string, { sheet: string, rowIdx0: number, priority: number }[]>} */
  const byKey = new Map();

  for (const sheetName of SHEET_PRIORITY) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:D`,
    });
    const rows = res.data.values || [];
    const pri = sheetPriorityIndex(sheetName);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (isLikelyHeaderRow(row)) continue;
      const b = String(row?.[1] ?? '').trim();
      if (!b) continue;
      const k = normalizeBrandNameKey(b);
      if (!k) continue;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push({ sheet: sheetName, rowIdx0: i, priority: pri });
    }
  }

  /** @type {Map<string, number[]>} sheet -> row indices to delete (snapshot 0-based) */
  const deletesBySheet = new Map();
  let totalDel = 0;

  for (const [k, occurrences] of byKey) {
    if (occurrences.length < 2) continue;
    occurrences.sort((a, b) => a.priority - b.priority);
    const keep = occurrences[0];
    for (const d of occurrences.slice(1)) {
      logFn(`  重複削除予定: 「${k}」← ${d.sheet} 行${d.rowIdx0 + 1}（残す: ${keep.sheet}）`);
      if (!deletesBySheet.has(d.sheet)) deletesBySheet.set(d.sheet, []);
      deletesBySheet.get(d.sheet).push(d.rowIdx0);
      totalDel++;
    }
  }

  for (const [sheetName, idxs] of deletesBySheet) {
    const sheetId = sheetIdByTitle.get(sheetName);
    if (sheetId == null) continue;
    const desc = uniqueSortedDesc(idxs);
    const requests = desc.map((idx) => ({
      deleteDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 },
      },
    }));
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  }

  if (totalDel === 0) logFn('  シート間重複なし（または1シートのみ該当）');
  else logFn(`  合計 ${totalDel} 行を削除しました`);
}

const __dedupeFile = fileURLToPath(import.meta.url);
if (process.argv[1] === __dedupeFile) {
  dedupeSheetsByBrandPriority({ log: console.log }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
