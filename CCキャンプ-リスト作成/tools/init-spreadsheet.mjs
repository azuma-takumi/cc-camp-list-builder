#!/usr/bin/env node

/**
 * init-spreadsheet.mjs — スプレッドシート接続テスト
 *
 * スプレッドシートに接続できるか確認する。
 * --id オプションでスプレッドシートIDを .env に保存できる。
 *
 * Usage:
 *   node tools/init-spreadsheet.mjs              # 接続テスト
 *   node tools/init-spreadsheet.mjs --id XXXXX   # IDを保存して接続テスト
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { google } from "googleapis";
import dotenv from "dotenv";

const PROJECT_ROOT = join(dirname(import.meta.url.replace("file://", "")), "..");
dotenv.config({ path: join(PROJECT_ROOT, ".env") });

let SPREADSHEET_ID = process.env.SPREADSHEET_ID;

function saveSpreadsheetId(newId) {
  const envPath = join(PROJECT_ROOT, ".env");
  let envContent = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
  if (envContent.match(/^SPREADSHEET_ID=.*$/m)) {
    envContent = envContent.replace(/^SPREADSHEET_ID=.*$/m, `SPREADSHEET_ID=${newId}`);
  } else {
    envContent += `\nSPREADSHEET_ID=${newId}\n`;
  }
  writeFileSync(envPath, envContent, "utf-8");
  SPREADSHEET_ID = newId;
}

function getAuthClient() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error("Error: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が .env に設定されていません");
    process.exit(1);
  }
  const tokensPath = process.env.GOOGLE_TOKENS_PATH || join(PROJECT_ROOT, "credentials", "tokens.json");
  if (!existsSync(tokensPath)) {
    console.error(`Error: トークンファイルが見つかりません: ${tokensPath}`);
    console.error("以下を実行してください: node auth-google.mjs");
    process.exit(1);
  }
  const tokens = JSON.parse(readFileSync(tokensPath, "utf-8"));
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  client.setCredentials(tokens);
  return client;
}

async function main() {
  const idFlag = process.argv.indexOf("--id");
  if (idFlag !== -1 && process.argv[idFlag + 1]) {
    const newId = process.argv[idFlag + 1];
    saveSpreadsheetId(newId);
    console.log(`SPREADSHEET_ID を保存しました: ${newId}`);
  }

  if (!SPREADSHEET_ID) {
    console.error("Error: SPREADSHEET_ID が設定されていません");
    console.error("Usage: node tools/init-spreadsheet.mjs --id YOUR_SPREADSHEET_ID");
    process.exit(1);
  }

  console.log(`接続テスト中... (ID: ${SPREADSHEET_ID})`);
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });

  console.log(`✓ 接続成功: 「${res.data.properties.title}」`);

  const sheetNames = res.data.sheets.map((s) => s.properties.title);
  console.log(`  シート: ${sheetNames.join(", ")}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
