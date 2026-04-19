#!/usr/bin/env node
/**
 * TVショッピングシートのD列（問合せフォーム）にメアドが入っている行を
 * E列（メアド）に移動し、D列をクリアする。
 *
 * 対象行（1-indexed）: 4, 19, 35, 42, 43, 48, 49, 53, 56
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEET_TITLE = '1.TVショッピング';
const TARGET_ROWS = [4, 19, 35, 42, 43, 48, 49, 53, 56];

async function main() {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // 対象行の D・E 列を読み込む
  const ranges = TARGET_ROWS.map(r => `'${SHEET_TITLE}'!D${r}:E${r}`);
  const batchGet = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges,
  });

  const valueRanges = batchGet.data.valueRanges || [];
  const updateData = [];

  for (let i = 0; i < TARGET_ROWS.length; i++) {
    const rowNum = TARGET_ROWS[i];
    const row = valueRanges[i]?.values?.[0] || [];
    const dVal = String(row[0] ?? '').trim();
    const eVal = String(row[1] ?? '').trim();

    if (!dVal) {
      console.log(`  行${rowNum}: D列が空 → スキップ`);
      continue;
    }

    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dVal);
    if (!isEmail) {
      console.log(`  行${rowNum}: 「${dVal}」はメアドではない → スキップ`);
      continue;
    }

    if (eVal) {
      console.log(`  行${rowNum}: E列に既存値「${eVal}」あり → D=${dVal} を上書きして移動`);
    } else {
      console.log(`  行${rowNum}: 「${dVal}」を D→E に移動`);
    }

    // E列に移動、D列をクリア
    updateData.push({
      range: `'${SHEET_TITLE}'!D${rowNum}:E${rowNum}`,
      values: [['', dVal]],
    });
  }

  if (updateData.length === 0) {
    console.log('移動対象なし');
    return;
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: updateData,
    },
  });

  console.log(`\n✅ ${updateData.length} 件のメアドを D列 → E列に移動しました`);
}

main().catch(e => { console.error(e); process.exit(1); });
