#!/usr/bin/env node
/**
 * 「3.Yahoo」を D=問い合わせフォームURL・E=メール（任意）に揃える。
 * 旧データで D にメールや別URLが入っている行は、C 列の店URLから store ID を取り、
 * D を talk フォームにし、メールは E に移す（URLは捨てる）。
 *
 *   node migrate-yahoo-contact-columns.mjs --dry-run
 *   node migrate-yahoo-contact-columns.mjs
 *   node migrate-yahoo-contact-columns.mjs --attack   # アタックブックも同様に更新
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { yahooTalkContactUrl, yahooContactEmailFromFetched } from './utils.mjs';
import { ATTACK_SPREADSHEET_ID } from './attack-spreadsheet-config.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEET = '3.Yahoo';

function extractStoreIdFromShopUrl(c) {
  const m = String(c ?? '').match(/store\.shopping\.yahoo\.co\.jp\/([a-zA-Z0-9_-]+)/);
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

function buildMigratedRow(row) {
  const storeId = extractStoreIdFromShopUrl(row[2]);
  if (!storeId) return null;
  const talk = yahooTalkContactUrl(storeId);
  const oldD = row[3];
  const oldE = row[4];
  const email =
    yahooContactEmailFromFetched(oldE) || yahooContactEmailFromFetched(oldD);
  return [row[0] ?? '', row[1] ?? '', row[2] ?? '', talk, email, row[5] ?? ''];
}

function rowDiffers(oldRow, newRow) {
  const pad = (r) => [...(r || []), '', '', '', '', '', ''].slice(0, 6);
  const o = pad(oldRow);
  const n = pad(newRow);
  return o.some((v, i) => String(v ?? '').trim() !== String(n[i] ?? '').trim());
}

async function migrateSpreadsheet(sheets, spreadsheetId, label, dryRun) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET}'!A:F`,
  });
  const rows = res.data.values || [];
  let updated = 0;
  let skippedNoId = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    if (isHeaderRow(row)) continue;
    const built = buildMigratedRow(row);
    if (!built) {
      skippedNoId++;
      console.warn(`[${label}] 行${i + 1}: C列から store ID を取得できません — スキップ`);
      continue;
    }
    if (!rowDiffers(row, built)) continue;
    updated++;
    console.log(`[${label}] 行${i + 1}: D/E を更新`);
    if (!dryRun) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${SHEET}'!A${i + 1}:F${i + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [built] },
      });
    }
  }

  console.log(
    `[${label}] 完了: 更新 ${updated} 行、store ID なし ${skippedNoId} 行${dryRun ? '（dry-run）' : ''}`,
  );
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const attack = process.argv.includes('--attack');
  const sheets = await getSheetsClient();
  await migrateSpreadsheet(sheets, getSpreadsheetId(), 'メイン', dryRun);
  if (attack) {
    await migrateSpreadsheet(sheets, ATTACK_SPREADSHEET_ID, 'アタック', dryRun);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
