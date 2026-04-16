/**
 * メイン vs アタックの「1.TVショッピング」「2.自社通販」を B列キーで比較（一回限りでなく npm script から実行可）。
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { normalizeBrandNameKey } from './utils.mjs';
import { ATTACK_SPREADSHEET_ID, ATTACK_LIST_COPY_ROUTES } from './attack-spreadsheet-config.mjs';
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

/** @returns {Map<string, { rowNums: number[], ad: string[][] }>} */
function collectByBrandKey(rows) {
  const map = new Map();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    if (isLikelyHeaderRow(row)) continue;
    const name = String(row[1] ?? '').trim();
    const url = String(row[2] ?? '').trim();
    if (!name && !url) continue;
    const k = normalizeBrandNameKey(name);
    if (!k) continue;
    const ad = [0, 1, 2, 3].map((j) => String(row[j] ?? '').trim());
    if (!map.has(k)) {
      map.set(k, { rowNums: [], ads: [] });
    }
    const e = map.get(k);
    e.rowNums.push(i + 1);
    e.ads.push(ad);
  }
  return map;
}

function adStr(ad) {
  return ad.join('\t');
}

function reportInternalDupes(label, which, map) {
  const dups = [...map.entries()].filter(([, v]) => v.ads.length > 1);
  if (dups.length === 0) return;
  console.log(`${which} 内・同一ブランドキーが複数行: ${dups.length} 件`);
  for (const [k, v] of dups.slice(0, 20)) {
    console.log(`  「${v.ads[0][1]}」 行: ${v.rowNums.join(', ')}`);
  }
  if (dups.length > 20) console.log(`  …他 ${dups.length - 20} 件`);
}

function compareMaps(label, mainMap, atkMap) {
  const mainKeys = new Set(mainMap.keys());
  const atkKeys = new Set(atkMap.keys());

  const onlyAtk = [...atkKeys].filter((k) => !mainKeys.has(k)).sort();
  const onlyMain = [...mainKeys].filter((k) => !atkKeys.has(k)).sort();

  const contentDiff = [];
  for (const k of mainKeys) {
    if (!atkKeys.has(k)) continue;
    const m = mainMap.get(k);
    const a = atkMap.get(k);
    const mCanon = m.ads[0];
    const aCanon = a.ads[0];
    if (adStr(mCanon) !== adStr(aCanon)) {
      contentDiff.push({
        key: k,
        mainRows: m.rowNums,
        atkRows: a.rowNums,
        mainSample: mCanon[1],
        mainCD: `${mCanon[2].slice(0, 48)}… / ${mCanon[3].slice(0, 48)}…`,
        atkCD: `${aCanon[2].slice(0, 48)}… / ${aCanon[3].slice(0, 48)}…`,
      });
    }
    if (m.ads.length !== a.ads.length) {
      contentDiff.push({
        key: k,
        dupNote: `メイン${m.ads.length}行 / アタック${a.ads.length}行（先頭行は上記の有無で判定）`,
      });
    }
  }

  console.log('\n======== ' + label + ' ========');
  reportInternalDupes(label, 'メイン', mainMap);
  reportInternalDupes(label, 'アタック', atkMap);
  console.log(`メイン独自ブランド数: ${onlyMain.length}`);
  if (onlyMain.length) {
    onlyMain.slice(0, 80).forEach((k) => {
      const m = mainMap.get(k);
      console.log(`  [メインのみ] ${m.ads[0][1]} （行: ${m.rowNums.join(',')}）`);
    });
    if (onlyMain.length > 80) console.log(`  …他 ${onlyMain.length - 80} 件`);
  }

  console.log(`アタックのみブランド数: ${onlyAtk.length}`);
  if (onlyAtk.length) {
    onlyAtk.forEach((k) => {
      const a = atkMap.get(k);
      console.log(`  [アタックのみ] ${a.ads[0][1]} （行: ${a.rowNums.join(',')}）`);
    });
  }

  const uniqContent = contentDiff.filter((x) => !x.dupNote);
  const dupNotes = contentDiff.filter((x) => x.dupNote);
  console.log(`A:D内容が先頭行で不一致: ${uniqContent.length} ブランド`);
  for (const x of uniqContent.slice(0, 40)) {
    console.log(`  「${x.mainSample}」 メイン行${x.mainRows[0]} vs アタック行${x.atkRows[0]}`);
    console.log(`    メイン C,D略: ${x.mainCD}`);
    console.log(`    アタック C,D略: ${x.atkCD}`);
  }
  if (uniqContent.length > 40) console.log(`  …他 ${uniqContent.length - 40} 件`);
  for (const x of dupNotes) {
    console.log(`  [重複行数差] ${x.key}: ${x.dupNote}`);
  }

  if (onlyMain.length === 0 && onlyAtk.length === 0 && contentDiff.length === 0) {
    console.log('→ ブランド集合・先頭行 A:D は一致しています。');
  }
}

async function main() {
  const sheets = await getSheetsClient();
  const mainId = getSpreadsheetId();

  for (const key of ['tv', 'own']) {
    const route = ATTACK_LIST_COPY_ROUTES[key];
    const title = route.mainSheetTitle;

    const [mainRes, atkRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: mainId,
        range: `'${title}'!A:D`,
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: ATTACK_SPREADSHEET_ID,
        range: `'${title}'!A:D`,
      }),
    ]);

    const mainMap = collectByBrandKey(mainRes.data.values || []);
    const atkMap = collectByBrandKey(atkRes.data.values || []);
    compareMaps(title, mainMap, atkMap);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
