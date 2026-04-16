#!/usr/bin/env node

import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { getSheetsClient } from "./lib/sheets.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function getArgValue(flagName) {
  const index = process.argv.indexOf(flagName);
  return index >= 0 ? process.argv[index + 1] : "";
}

async function main() {
  const inputPath = getArgValue("--input");
  const title = getArgValue("--title") || `CCキャンプ 会話履歴 ${new Date().toISOString().slice(0, 10)}`;
  const spreadsheetIdArg = getArgValue("--spreadsheet-id");
  const sheetName = getArgValue("--sheet-name") || "会話履歴";

  if (!inputPath) {
    throw new Error("--input に会話JSONのパスを指定してください");
  }

  const absoluteInputPath = inputPath.startsWith("/")
    ? inputPath
    : join(__dirname, "..", inputPath);

  const messages = JSON.parse(readFileSync(absoluteInputPath, "utf-8"));
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("会話JSONが空か、配列ではありません");
  }

  const sheets = await getSheetsClient();
  let spreadsheetId = spreadsheetIdArg;
  let spreadsheetUrl = "";

  if (!spreadsheetId) {
    const createRes = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
        sheets: [
          {
            properties: {
              title: sheetName,
              gridProperties: {
                rowCount: Math.max(messages.length + 10, 100),
                columnCount: 4,
              },
            },
          },
        ],
      },
    });

    spreadsheetId = createRes.data.spreadsheetId;
    spreadsheetUrl = createRes.data.spreadsheetUrl || "";
    if (!spreadsheetId || !spreadsheetUrl) {
      throw new Error("スプレッドシートの作成に失敗しました");
    }
  } else {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    spreadsheetUrl = meta.data.spreadsheetUrl || "";

    const existingSheetNames = (meta.data.sheets || []).map((sheet) => sheet.properties?.title);
    if (!existingSheetNames.includes(sheetName)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName,
                  gridProperties: {
                    rowCount: Math.max(messages.length + 10, 100),
                    columnCount: 4,
                  },
                },
              },
            },
          ],
        },
      });
    }
  }

  const values = [
    ["No", "役割", "内容", "補足"],
    ...messages.map((message, index) => [
      index + 1,
      message.role || "",
      message.content || "",
      message.note || "",
    ]),
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!A1:D${values.length}`,
    valueInputOption: "RAW",
    requestBody: { values },
  });

  console.log(`TITLE=${title}`);
  console.log(`SPREADSHEET_ID=${spreadsheetId}`);
  console.log(`SPREADSHEET_URL=${spreadsheetUrl}`);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
