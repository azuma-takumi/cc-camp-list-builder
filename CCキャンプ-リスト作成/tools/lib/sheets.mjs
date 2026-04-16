import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { google } from "googleapis";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = join(__dirname, "..", "..");
const ENV_PATH = join(PROJECT_ROOT, ".env");
const TOKENS_PATH =
  process.env.GOOGLE_TOKENS_PATH || join(PROJECT_ROOT, "credentials", "tokens.json");

dotenv.config({ path: ENV_PATH });

let spreadsheetId = process.env.SPREADSHEET_ID || "";
let sheetsClient;

export function saveSpreadsheetId(newId) {
  let envContent = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf-8") : "";

  if (envContent.match(/^SPREADSHEET_ID=.*$/m)) {
    envContent = envContent.replace(/^SPREADSHEET_ID=.*$/m, `SPREADSHEET_ID=${newId}`);
  } else {
    envContent += `${envContent.endsWith("\n") || envContent === "" ? "" : "\n"}SPREADSHEET_ID=${newId}\n`;
  }

  writeFileSync(ENV_PATH, envContent, "utf-8");
  spreadsheetId = newId;
  process.env.SPREADSHEET_ID = newId;
  sheetsClient = null;
}

function getOAuthClient() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が .env に設定されていません");
  }

  if (!existsSync(TOKENS_PATH)) {
    throw new Error(`トークンファイルが見つかりません: ${TOKENS_PATH}`);
  }

  const tokens = JSON.parse(readFileSync(TOKENS_PATH, "utf-8"));
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  client.setCredentials(tokens);
  return client;
}

export function getSpreadsheetId() {
  if (!spreadsheetId) {
    throw new Error("SPREADSHEET_ID が設定されていません");
  }
  return spreadsheetId;
}

export async function getSheetsClient() {
  if (sheetsClient) {
    return sheetsClient;
  }

  const auth = getOAuthClient();
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

export async function getSpreadsheetMeta() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.get({
    spreadsheetId: getSpreadsheetId(),
  });

  return res.data;
}

export async function readSheetValues(sheetName, range = "A:ZZ") {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `'${sheetName}'!${range}`,
  });

  return res.data.values || [];
}

export async function updateCell(sheetName, cellA1, value) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `'${sheetName}'!${cellA1}`,
    valueInputOption: "RAW",
    requestBody: { values: [[value]] },
  });
}

export async function appendRows(sheetName, rows) {
  if (!rows.length) {
    return;
  }

  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `'${sheetName}'!A:ZZ`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}

export async function updateRows(sheetName, startRow, startColumnIndex, rows) {
  if (!rows.length) {
    return;
  }

  const sheets = await getSheetsClient();
  const startCol = toColumnLetter(startColumnIndex);
  const endCol = toColumnLetter(startColumnIndex + rows[0].length - 1);
  const endRow = startRow + rows.length - 1;

  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `'${sheetName}'!${startCol}${startRow}:${endCol}${endRow}`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}

export async function createSpreadsheet(title, sheetName = "Sheet1", columnCount = 8) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [
        {
          properties: {
            title: sheetName,
            gridProperties: {
              rowCount: 200,
              columnCount,
            },
          },
        },
      ],
    },
  });

  if (!res.data.spreadsheetId || !res.data.spreadsheetUrl) {
    throw new Error("スプレッドシートの作成に失敗しました");
  }

  return {
    spreadsheetId: res.data.spreadsheetId,
    spreadsheetUrl: res.data.spreadsheetUrl,
  };
}

export function toColumnLetter(index) {
  let current = index + 1;
  let result = "";

  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }

  return result;
}
