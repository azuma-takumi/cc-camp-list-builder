#!/usr/bin/env node
/**
 * メイン（および任意でアタック）の「3.Yahoo」で、D列のお問い合わせフォームURLを
 * C列の店URLから求めた store ID に基づき正規化する。
 * （https://talk.shopping.yahoo.co.jp/contact/{store_id}）
 *
 * E列・F列は維持。A〜Cは変更しない。
 *
 *   node fix-yahoo-talk-urls.mjs --dry-run
 *   node fix-yahoo-talk-urls.mjs
 *   node fix-yahoo-talk-urls.mjs --attack
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { yahooTalkContactUrl, yahooContactEmailFromFetched } from './utils.mjs';
import { ATTACK_SPREADSHEET_ID } from './attack-spreadsheet-config.mjs';
import { writeLatestSummary } from './summary-writer.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEET = '3.Yahoo';

function extractStoreIdFromShopUrl(c) {
  const s = String(c ?? '').trim();
  if (!s) return '';
  const m = s.match(/store\.shopping\.yahoo\.co\.jp\/([a-zA-Z0-9_-]+)/i);
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

function normalizeD(d) {
  return String(d ?? '').trim();
}

async function fixBook(sheets, spreadsheetId, label, dryRun) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET}'!A:F`,
  });
  const rows = res.data.values || [];
  let changed = 0;
  let skippedNoId = 0;
  const changedLines = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    if (isHeaderRow(row)) continue;

    const storeId = extractStoreIdFromShopUrl(row[2]);
    if (!storeId) {
      skippedNoId++;
      console.warn(`[${label}] 行${i + 1}: C列から store ID を取得できません — スキップ`);
      continue;
    }

    const correct = yahooTalkContactUrl(storeId);
    const current = normalizeD(row[3]);
    if (current === correct) continue;

    changed++;
    changedLines.push(`- 行${i + 1}: ${current.slice(0, 60)}${current.length > 60 ? '…' : ''} -> ${correct}`);
    const oldD = row[3];
    const oldE = row[4];
    const email =
      yahooContactEmailFromFetched(oldE) || yahooContactEmailFromFetched(oldD);
    const out = [row[0] ?? '', row[1] ?? '', row[2] ?? '', correct, email, row[5] ?? ''];
    console.log(`[${label}] 行${i + 1}: D列を更新\n  旧: ${current.slice(0, 80)}${current.length > 80 ? '…' : ''}\n  新: ${correct}`);

    if (!dryRun) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${SHEET}'!A${i + 1}:F${i + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [out] },
      });
    }
  }

  console.log(`[${label}] ${dryRun ? '（dry-run）' : ''}D列を直した行: ${changed}`);
  return { label, changed, skippedNoId, changedLines };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const attack = process.argv.includes('--attack');
  const sheets = await getSheetsClient();
  const results = [];

  results.push(await fixBook(sheets, getSpreadsheetId(), 'メイン', dryRun));
  if (attack) {
    results.push(await fixBook(sheets, ATTACK_SPREADSHEET_ID, 'アタック', dryRun));
  }
  const totalChanged = results.reduce((sum, item) => sum + item.changed, 0);
  const totalSkippedNoId = results.reduce((sum, item) => sum + item.skippedNoId, 0);
  writeLatestSummary({
    title: 'Yahoo問い合わせURL補正サマリー',
    overview: [
      { label: '対象タブ', value: SHEET },
      { label: 'dry-run', value: dryRun ? 'はい' : 'いいえ' },
      { label: 'アタック反映', value: attack ? 'あり' : 'なし' },
    ],
    metrics: [
      { label: '更新件数', value: `${totalChanged}件` },
      { label: 'store ID 解析不可', value: `${totalSkippedNoId}件` },
      { label: '対象ブック数', value: `${results.length}件` },
    ],
    sections: results.map((result) => ({
      heading: `${result.label}の更新内容`,
      lines: result.changedLines.length ? result.changedLines : ['- 更新なし'],
    })),
  });
  if (dryRun) console.log('\n実行するには --dry-run を外して: node fix-yahoo-talk-urls.mjs');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
