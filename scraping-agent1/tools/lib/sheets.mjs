/**
 * sheets.mjs — Google Sheets ヘルパー
 *
 * scraping-agent の設計:
 *   - 1リサーチ = 1シート
 *   - シート名: yyyyMMdd_<名前>
 *   - 共通4列: A=No. / B=タイトル / C=URL / D=取得日時
 *   - E列以降は動的(リサーチごとにカスタム)
 *
 * 必須 .env:
 *   SPREADSHEET_ID
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_TOKENS_PATH (デフォルト: ./credentials/tokens.json)
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = join(__dirname, "..", "..");
dotenv.config({ path: join(PROJECT_ROOT, ".env") });

export let SPREADSHEET_ID = process.env.SPREADSHEET_ID;

export const COMMON_HEADERS = ["No.", "タイトル", "URL", "取得日時"];
export const COMMON_COLS = COMMON_HEADERS.length; // 4列固定

const TOKENS_PATH =
  process.env.GOOGLE_TOKENS_PATH || join(PROJECT_ROOT, "credentials", "tokens.json");

// ===== 認証 =====

export function getAuthClient() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error("Error: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が .env に未設定");
    process.exit(1);
  }
  if (!existsSync(TOKENS_PATH)) {
    console.error(`Error: トークンファイルが見つかりません: ${TOKENS_PATH}`);
    console.error("実行: node auth-google.mjs");
    process.exit(1);
  }
  const tokens = JSON.parse(readFileSync(TOKENS_PATH, "utf-8"));
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  client.setCredentials(tokens);
  return client;
}

let _sheets;

export async function getSheets() {
  if (_sheets) return _sheets;
  if (!SPREADSHEET_ID) {
    console.error("Error: SPREADSHEET_ID が .env に未設定");
    process.exit(1);
  }
  const client = getAuthClient();
  _sheets = google.sheets({ version: "v4", auth: client });
  return _sheets;
}

export function saveSpreadsheetId(newId) {
  const envPath = join(PROJECT_ROOT, ".env");
  let envContent = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
  if (envContent.match(/^SPREADSHEET_ID=.*$/m)) {
    envContent = envContent.replace(/^SPREADSHEET_ID=.*$/m, `SPREADSHEET_ID=${newId}`);
  } else {
    envContent += `\nSPREADSHEET_ID=${newId}\n`;
  }
  writeFileSync(envPath, envContent, "utf-8");
  SPREADSHEET_ID = newId;
  process.env.SPREADSHEET_ID = newId;
  _sheets = null;
}

// ===== シート名ユーティリティ =====

/**
 * yyyyMMdd_<名前> 形式のシート名を組み立てる
 */
export function buildSheetName(name, date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const safe = name
    .replace(/[\/\\\[\]\*\?:]/g, "_") // Sheets のシート名に使えない文字を置換
    .trim();
  return `${yyyy}${mm}${dd}_${safe}`;
}

// ===== シート操作 =====

export async function getSpreadsheetMeta() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  return res.data;
}

export async function sheetExists(sheetName) {
  const meta = await getSpreadsheetMeta();
  return meta.sheets.some((s) => s.properties.title === sheetName);
}

export async function getSheetId(sheetName) {
  const meta = await getSpreadsheetMeta();
  const sheet = meta.sheets.find((s) => s.properties.title === sheetName);
  return sheet ? sheet.properties.sheetId : null;
}

/**
 * リサーチ用シートを新規作成し、ヘッダーを書き込む
 *
 * @param {string} sheetName - シート名(例: 20260420_新宿居酒屋)
 * @param {string[]} customColumns - E列以降のカスタム列名(例: ["業種", "住所", "電話番号"])
 */
export async function createResearchSheet(sheetName, customColumns = []) {
  const sheets = await getSheets();

  if (await sheetExists(sheetName)) {
    throw new Error(`シート「${sheetName}」は既に存在します`);
  }

  const headers = [...COMMON_HEADERS, ...customColumns];
  const colCount = headers.length;

  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: sheetName,
              gridProperties: { frozenRowCount: 1, columnCount: Math.max(colCount, 10) },
            },
          },
        },
      ],
    },
  });

  const sheetId = addRes.data.replies[0].addSheet.properties.sheetId;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers] },
  });

  const formatRequests = [
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: colCount,
        },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
          },
        },
        fields: "userEnteredFormat(textFormat,backgroundColor)",
      },
    },
    // No. 列(A): 50px
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 50 },
        fields: "pixelSize",
      },
    },
    // タイトル列(B): 300px
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
        properties: { pixelSize: 300 },
        fields: "pixelSize",
      },
    },
    // URL列(C): 350px
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 },
        properties: { pixelSize: 350 },
        fields: "pixelSize",
      },
    },
    // 取得日時列(D): 140px
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 3, endIndex: 4 },
        properties: { pixelSize: 140 },
        fields: "pixelSize",
      },
    },
  ];

  if (formatRequests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: formatRequests },
    });
  }

  return { sheetId, sheetName, headers };
}

/**
 * シートの全データを読む(ヘッダー含む)
 */
export async function readSheet(sheetName) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'`,
  });
  return res.data.values || [];
}

/**
 * 指定シートの末尾にデータを追記する
 *
 * @param {string} sheetName
 * @param {Array<object>} items - { title, url, extras: {...} } の配列
 *   extras はヘッダーに対応するキーと値のペア
 * @returns {{ appended: number, skipped: number }}
 */
export async function appendResearchRows(sheetName, items, options = {}) {
  const { skipDuplicateUrls = true } = options;
  const sheets = await getSheets();

  const existing = await readSheet(sheetName);
  if (existing.length === 0) {
    throw new Error(`シート「${sheetName}」が空です。先に createResearchSheet を実行してください`);
  }

  const headers = existing[0];
  const dataRows = existing.slice(1);
  const startNo = dataRows.length + 1;

  const existingUrls = new Set(
    dataRows.map((row) => (row[2] || "").trim()).filter((u) => u)
  );

  const now = formatDateTime(new Date());

  const toAppend = [];
  let skipped = 0;
  let no = startNo;

  for (const item of items) {
    const url = (item.url || "").trim();
    if (skipDuplicateUrls && url && existingUrls.has(url)) {
      skipped++;
      continue;
    }
    if (url) existingUrls.add(url);

    const row = [String(no), item.title || "", url, now];
    // カスタム列(E〜)をヘッダー順で埋める
    for (let i = COMMON_COLS; i < headers.length; i++) {
      const key = headers[i];
      const value = item.extras && key in item.extras ? item.extras[key] : "";
      row.push(typeof value === "string" ? value : JSON.stringify(value));
    }
    toAppend.push(row);
    no++;
  }

  if (toAppend.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A:A`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: toAppend },
    });
  }

  return { appended: toAppend.length, skipped };
}

/**
 * シートのカスタム列(E列以降)を拡張する
 * 既存シートに新しい項目を追加する場合に使う
 */
export async function addCustomColumns(sheetName, newColumns) {
  const sheets = await getSheets();
  const existing = await readSheet(sheetName);
  if (existing.length === 0) {
    throw new Error(`シート「${sheetName}」が見つかりません`);
  }
  const headers = existing[0];
  const currentCustom = headers.slice(COMMON_COLS);
  const toAdd = newColumns.filter((c) => !currentCustom.includes(c));
  if (toAdd.length === 0) return { added: [] };

  const newHeaders = [...headers, ...toAdd];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [newHeaders] },
  });

  return { added: toAdd };
}

/**
 * リサーチシート一覧を取得(yyyyMMdd_ プレフィックスで始まるもの)
 */
export async function listResearchSheets() {
  const meta = await getSpreadsheetMeta();
  return meta.sheets
    .map((s) => s.properties.title)
    .filter((name) => /^\d{8}_/.test(name))
    .sort()
    .reverse(); // 新しい順
}

// ===== ユーティリティ =====

function formatDateTime(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss}`;
}

export { formatDateTime };
