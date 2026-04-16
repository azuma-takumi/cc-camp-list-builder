#!/usr/bin/env node
/**
 * メイン「3.Yahoo」だけ。指定行以降の B列を、会社概要（info.html）のストア名と照合して直す。
 * --from=2 が既定。--only-bad のときは壊れた行・IDスラッグっぽい B だけ更新。
 * アタックは変更しない。
 *
 *   node fix-yahoo-shop-names-main-from-row.mjs --from=2
 *   node fix-yahoo-shop-names-main-from-row.mjs --from=2 --only-bad  # 英字スラッグ等のみ（一括修正向け）
 *   node ... --dry-run  # 書き込みせず件数・差分だけ表示
 *
 * B 列は会社概要のストア名のみ（末尾の「 サプリ」「 ウォーター」は付けない）。F列（検索クエリ）はそのまま。Sheets 書き込みは batchUpdate。
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import {
  delay,
  shopDisplayNameForYahoo,
  preventSheetAutoLinkInShopName,
  fetchYahooOfficialStoreNameFromInfoHtml,
  looksLikeYahooRomanSlugDisplayName,
} from './utils.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEET = '3.Yahoo';

function getFromRow() {
  const a = process.argv.find((x) => x.startsWith('--from='));
  if (!a) return 2;
  const n = Number(a.slice('--from='.length));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2;
}

function extractStoreId(c) {
  const m = String(c ?? '').match(/store\.shopping\.yahoo\.co\.jp\/([a-zA-Z0-9_-]+)/i);
  return m ? m[1] : '';
}

function isHeaderRow(row) {
  const a = String(row?.[0] ?? '').trim();
  const c = String(row?.[2] ?? '').trim();
  const d = String(row?.[3] ?? '').trim();
  if (/^カテゴリ$/i.test(a)) return true;
  if (c === 'URL') return true;
  if (d === 'メアド' || d === '問合せフォーム' || d === '問い合わせフォーム') return true;
  return false;
}

/** B列が明らかに壊れている・プレースホルダっぽいとき true */
function looksBadShopName(b, storeId) {
  const s = String(b ?? '').trim();
  if (!s) return true;
  if (s === 'ヤフーショッピングTOP') return true;
  if (/^ヤフー[!！]?ショッピング\s*TOP$/i.test(s)) return true;
  if (/\uFFFD/.test(s)) return true;
  if (/�/.test(s)) return true;
  if (s.length > 140) return true;
  if (looksLikeYahooRomanSlugDisplayName(s, storeId)) return true;
  return false;
}

function normCompare(a, b) {
  return String(a).replace(/\u200b/g, '').trim() === String(b).replace(/\u200b/g, '').trim();
}

const BATCH_RANGE_COUNT = 40;

async function flushBatchUpdates(sheets, spreadsheetId, batch) {
  if (batch.length === 0) return;
  const data = batch.map(({ rowNum, values }) => ({
    range: `'${SHEET}'!A${rowNum}:F${rowNum}`,
    values: [values],
  }));
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data,
        },
      });
      return;
    } catch (e) {
      const code = e?.code ?? e?.response?.status;
      if (code === 429 && attempt < 5) {
        const wait = 15000 * (attempt + 1);
        console.warn(`  （Sheets レート制限のため ${wait / 1000} 秒待って再試行）`);
        await delay(wait);
        continue;
      }
      throw e;
    }
  }
}

async function main() {
  const fromRow = getFromRow();
  const dryRun = process.argv.includes('--dry-run');
  const onlyBad = process.argv.includes('--only-bad');

  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET}'!A:F`,
  });
  const rows = res.data.values || [];
  let fixed = 0;
  /** @type {{ rowNum: number, values: string[] }[]} */
  let pending = [];

  for (let i = fromRow - 1; i < rows.length; i++) {
    const rowNum = i + 1;
    const row = rows[i] || [];
    if (isHeaderRow(row)) continue;

    const cat = String(row[0] ?? '').trim();
    const b = row[1] ?? '';
    const c = row[2] ?? '';
    const storeId = extractStoreId(c);
    if (!storeId) continue;

    if (onlyBad && !looksBadShopName(b, storeId)) continue;

    await delay(800 + Math.random() * 500);
    const official = await fetchYahooOfficialStoreNameFromInfoHtml(storeId);
    if (!official) {
      console.warn(`行${rowNum} (${storeId}): 会社概要からストア名を取得できませんでした`);
      await delay(10000 + Math.random() * 5000);
      continue;
    }

    const newB = preventSheetAutoLinkInShopName(shopDisplayNameForYahoo(official, cat));
    if (normCompare(b, newB)) continue;

    console.log(`行${rowNum} [${storeId}]\n  旧: ${String(b).slice(0, 80)}${String(b).length > 80 ? '…' : ''}\n  新: ${newB}`);
    fixed++;
    if (!dryRun) {
      pending.push({
        rowNum,
        values: [cat, newB, row[2] ?? '', row[3] ?? '', row[4] ?? '', row[5] ?? ''],
      });
      if (pending.length >= BATCH_RANGE_COUNT) {
        await flushBatchUpdates(sheets, spreadsheetId, pending);
        pending = [];
      }
    }
  }

  if (!dryRun && pending.length > 0) {
    await flushBatchUpdates(sheets, spreadsheetId, pending);
  }

  console.log(dryRun ? `dry-run: 更新予定 ${fixed} 行` : `✅ 完了: ${fixed} 行を更新`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
