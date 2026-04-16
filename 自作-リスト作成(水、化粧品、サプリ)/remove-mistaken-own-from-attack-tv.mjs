#!/usr/bin/env node
/**
 * アタックリストの「1.TVショッピング」に誤って自社通販コピーで追記された行を削除する。
 * 検証: 1-based 行 55 が ファンケル、行 99 が ソフィーナ（以前の追記ログと一致）→ 行 55–99 を deleteDimension。
 * メイン .env の SPREADSHEET_ID は未使用（削除のみアタックブック）。
 */
import { getSheetsClient } from './auth.mjs';
import { ATTACK_SPREADSHEET_ID, ATTACK_SHEET_ID } from './attack-spreadsheet-config.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const TV_TITLE = '1.TVショッピング';
const SHEET_ID = ATTACK_SHEET_ID.TV;
/** 1-based 行番号（スプレッドシート表示と一致） */
const FIRST_ROW = 55;
const LAST_ROW = 99;
const EXPECT_FIRST_B = 'ファンケル';
const EXPECT_LAST_B = 'ソフィーナ';

async function main() {
  const sheets = await getSheetsClient();

  const check = await sheets.spreadsheets.values.get({
    spreadsheetId: ATTACK_SPREADSHEET_ID,
    range: `'${TV_TITLE}'!B${FIRST_ROW}:B${LAST_ROW}`,
  });
  const col = check.data.values || [];
  const firstB = String(col[0]?.[0] ?? '').trim();
  const lastB = String(col[col.length - 1]?.[0] ?? '').trim();

  if (firstB !== EXPECT_FIRST_B) {
    throw new Error(
      `行${FIRST_ROW} の B 列が想定外です: "${firstB}" （想定: ${EXPECT_FIRST_B}）。手作業で範囲を確認してください。`
    );
  }
  if (lastB !== EXPECT_LAST_B) {
    throw new Error(
      `行${LAST_ROW} の B 列が想定外です: "${lastB}" （想定: ${EXPECT_LAST_B}）。手作業で範囲を確認してください。`
    );
  }

  const startIndex = FIRST_ROW - 1;
  const endIndex = LAST_ROW;
  const n = LAST_ROW - FIRST_ROW + 1;

  console.log(`「${TV_TITLE}」行 ${FIRST_ROW}〜${LAST_ROW}（${n} 行）を削除します`);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: ATTACK_SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: SHEET_ID,
              dimension: 'ROWS',
              startIndex,
              endIndex,
            },
          },
        },
      ],
    },
  });

  console.log('✅ TVシートから自社誤追記分を削除しました');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
