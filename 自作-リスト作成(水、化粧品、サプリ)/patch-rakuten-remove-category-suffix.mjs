#!/usr/bin/env node
/**
 * 4.Rakutenn シートの B 列から末尾の「 サプリ」「 ウォーター」を除去する。
 *
 *   node patch-rakuten-remove-category-suffix.mjs
 *   node patch-rakuten-remove-category-suffix.mjs --dry-run
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { delay } from './utils.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEET = '4.Rakutenn';
const BATCH_SIZE = 40;

/** 末尾の「 サプリ」「 ウォーター」を除去 */
function stripCategorySuffix(name) {
  return String(name ?? '')
    .replace(/\u200b/g, '')
    .replace(/\s+サプリ$/u, '')
    .replace(/\s+ウォーター$/u, '')
    .trim();
}

async function flushBatch(sheets, spreadsheetId, batch) {
  if (batch.length === 0) return;
  const data = batch.map(({ rowNum, values }) => ({
    range: `'${SHEET}'!B${rowNum}`,
    values: [[values]],
  }));
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data },
      });
      return;
    } catch (e) {
      const code = e?.code ?? e?.response?.status;
      if (code === 429 && attempt < 5) {
        const wait = 15000 * (attempt + 1);
        console.warn(`  レート制限のため ${wait / 1000} 秒待機...`);
        await delay(wait);
        continue;
      }
      throw e;
    }
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET}'!B:B`,
  });
  const rows = res.data.values || [];

  let fixed = 0;
  let pending = [];

  for (let i = 1; i < rows.length; i++) { // 1行目（ヘッダー）はスキップ
    const rowNum = i + 1;
    const original = String(rows[i]?.[0] ?? '');
    const stripped = stripCategorySuffix(original);
    if (original === stripped) continue;

    console.log(`行${rowNum}: "${original}" → "${stripped}"`);
    fixed++;

    if (!dryRun) {
      pending.push({ rowNum, values: stripped });
      if (pending.length >= BATCH_SIZE) {
        await flushBatch(sheets, spreadsheetId, pending);
        pending = [];
        await delay(1000);
      }
    }
  }

  if (!dryRun && pending.length > 0) {
    await flushBatch(sheets, spreadsheetId, pending);
  }

  console.log(dryRun ? `dry-run: 更新予定 ${fixed} 行` : `✅ 完了: ${fixed} 行を更新`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
