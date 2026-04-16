#!/usr/bin/env node
/**
 * メイン「4.Rakutenn」の B列を、会社概要（info.html）由来のストア名に揃える。
 * 会社名（c-spCompanyName）より、タイトル【楽天市場】…[会社概要] や dt/dd のストア名を優先（utils と同じロジック）。
 *
 *   node fix-rakuten-shop-names-from-info.mjs --from=2
 *   node fix-rakuten-shop-names-from-info.mjs --from=2 --dry-run
 *
 * シート書き込みは batchUpdate にまとめて分間レート制限を避ける。
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import {
  fetchRakutenHtml,
  extractRakutenStoreNameFromInfoHtml,
  parseRakutenShopTopTitle,
  delay,
  shopDisplayNameForMarketplaceCategory,
  preventSheetAutoLinkInShopName,
} from './utils.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEET = '4.Rakutenn';

function getFromRow() {
  const a = process.argv.find((x) => x.startsWith('--from='));
  if (!a) return 2;
  const n = Number(a.slice('--from='.length));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2;
}

function extractRakutenShopId(c) {
  const m = String(c ?? '').match(/rakuten\.co\.jp\/([a-zA-Z0-9_-]+)\/?/i);
  return m ? m[1] : '';
}

function isHeaderRow(row) {
  const a = String(row?.[0] ?? '').trim();
  const c = String(row?.[2] ?? '').trim();
  if (/^カテゴリ$/i.test(a)) return true;
  if (c === 'URL') return true;
  return false;
}

async function fetchOfficialStoreName(shopId) {
  const infoUrl = `https://www.rakuten.co.jp/${encodeURIComponent(shopId)}/info.html`;
  const shopUrl = `https://www.rakuten.co.jp/${encodeURIComponent(shopId)}/`;
  let infoHtml = '';
  try {
    infoHtml = await fetchRakutenHtml(infoUrl);
  } catch {
    return '';
  }
  let name = extractRakutenStoreNameFromInfoHtml(infoHtml);
  if (!name) {
    try {
      const topHtml = await fetchRakutenHtml(shopUrl);
      name = parseRakutenShopTopTitle(topHtml);
    } catch {
      /* noop */
    }
  }
  return name || '';
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
    const shopId = extractRakutenShopId(c);
    if (!shopId) continue;

    await delay(450 + Math.random() * 250);
    const official = await fetchOfficialStoreName(shopId);
    if (!official) {
      console.warn(`行${rowNum} (${shopId}): 会社概要からストア名を取得できませんでした`);
      continue;
    }

    const newB = preventSheetAutoLinkInShopName(
      shopDisplayNameForMarketplaceCategory(official, cat)
    );
    if (normCompare(b, newB)) continue;

    console.log(`行${rowNum} [${shopId}]\n  旧: ${String(b).slice(0, 100)}${String(b).length > 100 ? '…' : ''}\n  新: ${newB}`);
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
