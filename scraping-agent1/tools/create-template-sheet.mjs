#!/usr/bin/env node

/**
 * create-template-sheet.mjs — scraping-agent 用の空スプシを新規作成
 *
 * リサーチシートは実行時に都度追加されるため、ここでは「スプシ本体だけ」を作り、
 * ユーザーに URL を案内する。
 *
 * Usage: node tools/create-template-sheet.mjs
 */

import { getAuthClient } from "./lib/sheets.mjs";
import { google } from "googleapis";

async function main() {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  console.log("スプシを作成中...");

  const createRes = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title: "scraping-agent リサーチ",
        locale: "ja_JP",
      },
      sheets: [
        {
          properties: {
            title: "README",
            sheetId: 0,
            gridProperties: { frozenRowCount: 1 },
          },
        },
      ],
    },
  });

  const spreadsheetId = createRes.data.spreadsheetId;
  const spreadsheetUrl = createRes.data.spreadsheetUrl;

  // README シートに使い方メモを入れる
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "'README'!A1",
    valueInputOption: "RAW",
    requestBody: {
      values: [
        ["scraping-agent リサーチスプシ"],
        [""],
        ["Claude Code で「リサーチして」と言うと、このスプシに新しいシートが追加されます。"],
        ["シート名の形式: yyyyMMdd_<リサーチ名>(例: 20260420_新宿居酒屋)"],
        [""],
        ["各シートの共通列:"],
        ["  A: No.(連番)"],
        ["  B: タイトル"],
        ["  C: URL"],
        ["  D: 取得日時"],
        ["  E以降: リサーチごとのカスタム項目"],
        [""],
        ["スプシを直接編集しても構いませんが、B〜D列は自動で埋まる想定です。"],
      ],
    },
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true, fontSize: 14 },
              },
            },
            fields: "userEnteredFormat(textFormat)",
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId: 0, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
            properties: { pixelSize: 600 },
            fields: "pixelSize",
          },
        },
      ],
    },
  });

  console.log(`✓ スプシ作成完了`);
  console.log("");
  console.log(`スプシURL: ${spreadsheetUrl}`);
  console.log(`スプシID : ${spreadsheetId}`);
  console.log("");
  console.log("次のコマンドで .env に ID を保存します:");
  console.log(`  node tools/init-spreadsheet.mjs --id ${spreadsheetId}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
