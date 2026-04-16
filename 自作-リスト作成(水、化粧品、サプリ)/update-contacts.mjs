#!/usr/bin/env node
/**
 * シート内の既存ブランドのD列（問い合わせ先）を再取得して更新するスクリプト
 *
 * - D列が空、またはファイル名（.webp/.webm等）が入っている行を対象に
 *   改善版 fetchContactInfo で再取得する
 * - 取得できなかった行は削除する
 */

import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { fetchContactInfo, delay, log } from './utils.mjs';
import dotenv from 'dotenv';
dotenv.config();

const SAMPLE_ROWS = 10;

const TARGET_SHEETS = [
  '1.TVショッピング',
  '2.自社通販',
];

// ダミー/無効な問い合わせ先かどうかを判定
function isBadContact(val) {
  if (!val || val.trim() === '') return true;
  const lower = val.toLowerCase();
  // ファイル拡張子チェック
  const BAD_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.webm', '.mp4', '.mp3', '.mp', '.m4v', '.mov', '.ts', '.js', '.css', '.svg', '.woff', '.woff2', '.ttf', '.eot'];
  if (BAD_EXT.some(e => lower.endsWith(e))) return true;
  // 明らかなダミーメアドチェック (xxxx@, test@, info@example 等)
  if (/^(?:xxxx+|test|sample|dummy|example)@/.test(lower)) return true;
  return false;
}

async function updateSheet(sheets, spreadsheetId, sheetName) {
  log(`\n📋 [${sheetName}] 問い合わせ先を再取得`);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!A:D`,
  });
  const rows = res.data.values || [];

  // シートIDを取得（削除用）
  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const sheet = meta.data.sheets.find(s => s.properties.title === sheetName);
  const sheetId = sheet.properties.sheetId;

  const toDelete = []; // 最終的に問い合わせ先が見つからなかった行のインデックス

  for (let i = SAMPLE_ROWS; i < rows.length; i++) {
    const row = rows[i];
    const name = (row[1] || '').trim();
    const url  = (row[2] || '').trim();
    const currentContact = (row[3] || '').trim();

    if (!url) continue;

    if (!isBadContact(currentContact)) {
      log(`  ✅ 行${i + 1} ${name}: 既存OK → ${currentContact}`);
      continue;
    }

    log(`  🔍 行${i + 1} ${name}: 問い合わせ先を探索中...`);
    await delay(1000 + Math.random() * 500);

    const contact = await fetchContactInfo(url);

    if (!contact || isBadContact(contact)) {
      log(`  ⚠️  行${i + 1} ${name}: 見つからず → 削除予定`);
      toDelete.push(i);
      continue;
    }

    // D列を更新
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!D${i + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[contact]] },
    });
    log(`  ✓ 行${i + 1} ${name}: ${contact}`);
    await delay(500);
  }

  // 取得できなかった行を後ろから削除
  if (toDelete.length > 0) {
    log(`\n  🗑  ${toDelete.length} 件を削除（問い合わせ先なし）`);
    const requests = [...toDelete].reverse().map(idx => ({
      deleteDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 },
      },
    }));
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  }

  log(`  完了`);
}

async function main() {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  for (const sheetName of TARGET_SHEETS) {
    await updateSheet(sheets, spreadsheetId, sheetName);
  }

  log('\n✅ 全シート更新完了');
}

main().catch(console.error);
