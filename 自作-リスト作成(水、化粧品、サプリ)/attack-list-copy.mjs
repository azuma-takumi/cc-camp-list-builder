/**
 * メイン SPREADSHEET_ID のシート → アタックリストの対応タブへ追記する共通処理。
 * Yahoo/楽天はメインの F列（検索クエリ）はアタックにコピーしない（A〜E のみ）。
 * ルートは ATTACK_LIST_COPY_ROUTES のみ。個別に sheetId を差し替えないこと。
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { normalizeBrandNameKey, preventSheetAutoLinkInShopName } from './utils.mjs';
import {
  YAHOO_LAST_COL_LETTER,
  YAHOO_SHEET_COL_COUNT,
  RAKUTEN_LAST_COL_LETTER,
  RAKUTEN_SHEET_COL_COUNT,
} from './sheets.mjs';
import { ATTACK_SPREADSHEET_ID, ATTACK_LIST_COPY_ROUTES } from './attack-spreadsheet-config.mjs';

/** メインシートの読み取り幅 */
function getMainReadSpec(routeKey) {
  if (routeKey === 'yahoo') return { count: YAHOO_SHEET_COL_COUNT, letter: YAHOO_LAST_COL_LETTER };
  if (routeKey === 'rakuten') return { count: RAKUTEN_SHEET_COL_COUNT, letter: RAKUTEN_LAST_COL_LETTER };
  // TV・自社通販は A〜E（F列以降はコピーしない）
  return { count: 5, letter: 'E' };
}

/** アタックへ書く列（F 列は全ルートでコピーしない） */
function getAttackWriteSpec(routeKey) {
  if (routeKey === 'rakuten') return { count: 5, letter: 'E' };
  // yahoo / tv / own すべて A〜E
  return { count: 5, letter: 'E' };
}

/** @typedef {'tv' | 'own' | 'yahoo' | 'rakuten'} AttackCopyRouteKey */

const ROUTE_KEYS = /** @type {AttackCopyRouteKey[]} */ (['tv', 'own', 'yahoo', 'rakuten']);

function normalizeUrlKey(u) {
  const s = String(u ?? '').trim();
  if (!s) return '';
  try {
    const url = new URL(s.startsWith('http') ? s : `https://${s}`);
    let h = url.href.replace(/\/$/, '').toLowerCase();
    if (h.endsWith('/')) h = h.slice(0, -1);
    return h;
  } catch {
    return s.toLowerCase();
  }
}

function isLikelyHeaderRow(row) {
  const a = String(row?.[0] ?? '').trim();
  const b = String(row?.[1] ?? '').trim();
  if (/^カテゴリ$/i.test(a)) return true;
  if (a === 'category' || b === 'ショップ名' || b === '店舗名') return true;
  return false;
}

function normalizeRowForCompare(row, colCount) {
  const out = [];
  for (let i = 0; i < colCount; i++) {
    let v = String(row?.[i] ?? '').trim();
    if (i === 1) v = v.replace(/\u200b/g, '');
    out.push(v);
  }
  return out;
}

function rowsEqualNormalized(a, b, colCount) {
  const x = normalizeRowForCompare(a, colCount);
  const y = normalizeRowForCompare(b, colCount);
  return x.every((v, i) => v === y[i]);
}

function sanitizeRowBForSheet(row, colCount) {
  const r = [...row];
  while (r.length < colCount) r.push('');
  if (r.length > colCount) r.length = colCount;
  if (r.length >= 2) r[1] = preventSheetAutoLinkInShopName(r[1]);
  return r;
}

async function getSheetTitleByGid(sheets, spreadsheetId, gid) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const sh = meta.data.sheets.find((s) => s.properties.sheetId === gid);
  return sh?.properties?.title ?? null;
}

/**
 * @param {AttackCopyRouteKey} routeKey
 * @param {{
 *   maxSourceDataRows?: number | null;
 *   maxAppendRows?: number | null;
 * }} [options]
 * - maxSourceDataRows: メインの「先頭から何データ行」を候補にするか（未指定時はルートの値）
 * - maxAppendRows: 指定時はメインを先頭からすべて走査し、アタックに無い行だけを最大この件数まで追記（maxSourceDataRows は無視）
 */
export async function copyMainSheetToAttackList(routeKey, options = {}) {
  if (!ROUTE_KEYS.includes(routeKey)) {
    throw new Error(`コピールートは ${ROUTE_KEYS.join(', ')} のいずれかのみです（受け取り: ${String(routeKey)}）`);
  }

  const route = ATTACK_LIST_COPY_ROUTES[routeKey];
  const maxAppendRows = options.maxAppendRows != null ? options.maxAppendRows : null;
  const effectiveMax =
    maxAppendRows != null
      ? null
      : options.maxSourceDataRows !== undefined
        ? options.maxSourceDataRows
        : route.maxSourceDataRows;
  const sheets = await getSheetsClient();
  const sourceId = getSpreadsheetId();

  const targetTitle = await getSheetTitleByGid(sheets, ATTACK_SPREADSHEET_ID, route.attackSheetId);
  if (!targetTitle) {
    throw new Error(`アタック側 sheetId=${route.attackSheetId} のシートが見つかりません`);
  }
  if (targetTitle !== route.expectedAttackSheetTitle) {
    throw new Error(
      `アタック側タブ名がルート設定と不一致です: "${targetTitle}" （想定: ${route.expectedAttackSheetTitle}）。` +
        `attack-spreadsheet-config.mjs の ATTACK_LIST_COPY_ROUTES を直してください。`
    );
  }

  const mainSpec = getMainReadSpec(routeKey);
  const attackSpec = getAttackWriteSpec(routeKey);

  console.log(
    `経路 ${routeKey}: メイン「${route.mainSheetTitle}」→ アタック「${targetTitle}」 (${ATTACK_SPREADSHEET_ID})`
  );

  const srcRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sourceId,
    range: `'${route.mainSheetTitle}'!A:${mainSpec.letter}`,
  });
  const srcRows = srcRes.data.values || [];

  const candidates = [];
  for (const row of srcRows) {
    if (isLikelyHeaderRow(row)) continue;
    const cat = String(row[0] ?? '').trim();
    const name = String(row[1] ?? '').trim();
    const url = String(row[2] ?? '').trim();
    const d = String(row[3] ?? '').trim();
    const e = String(row[4] ?? '').trim();
    const f = String(row[5] ?? '').trim();
    if (!name && !url) continue;
    if (mainSpec.count === 6) {
      candidates.push([cat, name, url, d, e, f]);
    } else if (mainSpec.count >= 5) {
      candidates.push([cat, name, url, d, e]);
    } else {
      candidates.push([cat, name, url, d]);
    }
    if (effectiveMax != null && candidates.length >= effectiveMax) break;
  }

  if (candidates.length === 0) {
    console.log(`メイン「${route.mainSheetTitle}」に追記対象の行がありません`);
    return;
  }

  const tgtRes = await sheets.spreadsheets.values.get({
    spreadsheetId: ATTACK_SPREADSHEET_ID,
    range: `'${targetTitle}'!A:${attackSpec.letter}`,
  });
  const tgtRows = tgtRes.data.values || [];

  /** @type {string[][]} */
  let workingTgtRows = tgtRows.map((r) => (Array.isArray(r) ? [...r] : []));

  let updateCount = 0;
  if (route.updateExistingRowsByBrandKey) {
    const mainByBrand = new Map();
    for (const row of candidates) {
      const k = normalizeBrandNameKey(row[1]);
      if (k) mainByBrand.set(k, row);
    }

    const updatePayload = [];
    for (let i = 0; i < workingTgtRows.length; i++) {
      const row = workingTgtRows[i];
      if (isLikelyHeaderRow(row)) continue;
      const k = normalizeBrandNameKey(row[1] ?? '');
      if (!k) continue;
      const mainRow = mainByBrand.get(k);
      if (!mainRow) continue;
      if (rowsEqualNormalized(row, mainRow, attackSpec.count)) continue;
      const outRow = sanitizeRowBForSheet(mainRow, attackSpec.count);
      updatePayload.push({ rowNumber: i + 1, values: outRow });
      workingTgtRows[i] = [...outRow];
    }

    const CHUNK = 80;
    for (let c = 0; c < updatePayload.length; c += CHUNK) {
      const slice = updatePayload.slice(c, c + CHUNK);
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: ATTACK_SPREADSHEET_ID,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: slice.map((u) => ({
            range: `'${targetTitle}'!A${u.rowNumber}:${attackSpec.letter}${u.rowNumber}`,
            values: [u.values],
          })),
        },
      });
    }

    updateCount = updatePayload.length;
    for (const u of updatePayload) {
      console.log(`  ↻ 行${u.rowNumber} 「${u.values[1]}」← メインの A:${attackSpec.letter} に同期`);
    }
    if (updateCount > 0) {
      console.log(`既存 ${updateCount} 行をメインと同期しました`);
    }
  }

  // 重複キー = カテゴリ + URL（カテゴリが違えば同一URLでも別行として扱う）
  const existingKeys = new Set();
  for (const row of workingTgtRows) {
    const cat = String(row[0] ?? '').trim();
    const u = normalizeUrlKey(row[2]);
    const nk = normalizeBrandNameKey(row[1] ?? '');
    if (u) existingKeys.add(`${cat}::${u}`);
    else if (nk) existingKeys.add(`${cat}::name::${nk}`);
  }

  const appendLimit = maxAppendRows != null ? maxAppendRows : Infinity;
  const toAppend = [];
  for (const row of candidates) {
    const cat = row[0];
    const name = row[1];
    const url = row[2];
    const uKey = normalizeUrlKey(url);
    const nKey = normalizeBrandNameKey(name);
    const dupKey = uKey ? `${cat}::${uKey}` : `${cat}::name::${nKey}`;
    if (existingKeys.has(dupKey)) continue;

    const attackRow =
      attackSpec.count === 5 ? row.slice(0, 5) : [row[0], row[1], row[2], row[3]];
    toAppend.push(attackRow);
    existingKeys.add(dupKey);
    if (toAppend.length >= appendLimit) break;
  }

  if (toAppend.length === 0) {
    if (updateCount > 0) {
      console.log('追記なし（未登録ブランドはメインにありません）');
      console.log('✅ 完了');
      return;
    }
    if (maxAppendRows != null) {
      console.log(
        `追記なし（メイン${candidates.length}行を走査。アタックに無い店はなかったか、重複除外のみ）`
      );
    } else if (effectiveMax != null) {
      console.log(`追記なし（先頭${candidates.length}件はすべてアタックに既にあるか、重複除外済み）`);
    } else {
      console.log('追記なし（行はすべてアタックに既にあるか、重複除外済み）');
    }
    return;
  }

  let lastDataRow = 0;
  for (let i = 0; i < workingTgtRows.length; i++) {
    const row = workingTgtRows[i];
    const has =
      row && row.slice(0, attackSpec.count).some((c) => String(c ?? '').trim() !== '');
    if (has) lastDataRow = i + 1;
  }
  const startRow = lastDataRow + 1;

  if (maxAppendRows != null) {
    console.log(
      `メインを上から走査（${candidates.length} データ行）→ アタックに無い店を最大${maxAppendRows}件まで追記: ${toAppend.length} 件（A${startRow}:${attackSpec.letter}）`
    );
  } else if (effectiveMax != null) {
    console.log(
      `メイン先頭データ ${candidates.length} 件を評価 → 追記 ${toAppend.length} 件（A${startRow}:${attackSpec.letter}、書式は未変更）`
    );
  } else {
    console.log(`${toAppend.length} 件を A${startRow}:${attackSpec.letter} から書き込み（書式・列構造は触りません）`);
  }
  for (const r of toAppend) {
    console.log(`  + ${r[1]}`);
  }

  const toAppendSanitized = toAppend.map((r) => sanitizeRowBForSheet(r, attackSpec.count));

  // シートの行数が足りない場合は先に拡張する
  const neededRows = startRow + toAppendSanitized.length - 1;
  const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId: ATTACK_SPREADSHEET_ID, includeGridData: false });
  const sheetObj = sheetMeta.data.sheets.find((s) => s.properties.title === targetTitle);
  const currentRowCount = sheetObj?.properties?.gridProperties?.rowCount ?? 1000;
  if (neededRows > currentRowCount) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: ATTACK_SPREADSHEET_ID,
      requestBody: {
        requests: [{
          appendDimension: {
            sheetId: sheetObj.properties.sheetId,
            dimension: 'ROWS',
            length: neededRows - currentRowCount + 100, // 少し余裕を持たせる
          },
        }],
      },
    });
    console.log(`  シート行数を ${currentRowCount} → ${neededRows + 100} に拡張しました`);
  }

  // 大量行は 200 行ずつ分割して書き込む（API ペイロード制限対策）
  const WRITE_CHUNK = 200;
  for (let c = 0; c < toAppendSanitized.length; c += WRITE_CHUNK) {
    const slice = toAppendSanitized.slice(c, c + WRITE_CHUNK);
    const chunkStart = startRow + c;
    await sheets.spreadsheets.values.update({
      spreadsheetId: ATTACK_SPREADSHEET_ID,
      range: `'${targetTitle}'!A${chunkStart}:${attackSpec.letter}${chunkStart + slice.length - 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: slice },
    });
    if (toAppendSanitized.length > WRITE_CHUNK) {
      console.log(`  書き込み ${chunkStart}〜${chunkStart + slice.length - 1} 行目 (${c + slice.length}/${toAppendSanitized.length})`);
    }
  }

  console.log('✅ 完了');
}
