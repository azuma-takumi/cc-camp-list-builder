#!/usr/bin/env node

import { join } from "path";
import {
  getSpreadsheetMeta,
  readSheetValues,
  saveSpreadsheetId,
  toColumnLetter,
  updateCell,
} from "./lib/sheets.mjs";
import { parseRequestText, summarizeRequest } from "./lib/request-parser.mjs";
import { validateAndRepairUrl } from "./lib/url-checker.mjs";
import { appendDatedLog, writeStandardSummary } from "./lib/summary-writer.mjs";

const PROJECT_ROOT = new URL("..", import.meta.url).pathname;
const LOG_DIR = join(PROJECT_ROOT, "logs");
function getArgValue(flagName) {
  const index = process.argv.indexOf(flagName);
  return index !== -1 ? process.argv[index + 1] : "";
}

function extractSpreadsheetId(input) {
  if (!input) {
    throw new Error("スプレッドシートURLまたはIDが未指定です");
  }

  const trimmed = input.trim();
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return urlMatch ? urlMatch[1] : trimmed;
}

function detectUrlColumns(headers) {
  return headers
    .map((header, index) => ({ header: String(header || "").trim(), index }))
    .filter(
      (item) =>
        /url|サイト|ホームページ|link|リンク|問い合わせ|contact/i.test(item.header)
    );
}

function appendErrorLog(lines) {
  appendDatedLog({ logDir: LOG_DIR, prefix: "run", lines });
}

async function checkUrlColumns(sheetName, rows) {
  const headers = rows[0] || [];
  const dataRows = rows.slice(1);
  const urlColumns = detectUrlColumns(headers);

  const result = {
    checked: 0,
    fixed: 0,
    failed: 0,
    failedItems: [],
  };

  if (!urlColumns.length) {
    return result;
  }

  for (let rowOffset = 0; rowOffset < dataRows.length; rowOffset += 1) {
    const row = dataRows[rowOffset];
    const sheetRowNumber = rowOffset + 2;

    for (const column of urlColumns) {
      const currentValue = row[column.index] || "";
      if (!String(currentValue).trim()) {
        continue;
      }

      result.checked += 1;
      const checked = await validateAndRepairUrl(currentValue);

      if (checked.status === "fixed" && checked.finalValue !== currentValue) {
        const cell = `${toColumnLetter(column.index)}${sheetRowNumber}`;
        await updateCell(sheetName, cell, checked.finalValue);
        result.fixed += 1;
      }

      if (checked.status === "error") {
        result.failed += 1;
        result.failedItems.push({
          rowNumber: sheetRowNumber,
          columnName: column.header,
          originalValue: currentValue,
          logs: checked.logs,
        });
      }
    }
  }

  return result;
}

async function main() {
  const spreadsheetArg = getArgValue("--sheet");
  const requestText = getArgValue("--request");
  const sheetNameArg = getArgValue("--tab");

  if (!spreadsheetArg) {
    throw new Error("--sheet にスプレッドシートURLまたはIDを指定してください");
  }

  if (!requestText) {
    throw new Error("--request に依頼文を指定してください");
  }

  const spreadsheetId = extractSpreadsheetId(spreadsheetArg);
  saveSpreadsheetId(spreadsheetId);

  const parsedRequest = parseRequestText(requestText);
  const meta = await getSpreadsheetMeta();
  const availableSheets = (meta.sheets || []).map((sheet) => sheet.properties.title);
  const targetSheet = sheetNameArg || availableSheets[0];

  if (!targetSheet) {
    throw new Error("読み取れるシートがありませんでした");
  }

  const rows = await readSheetValues(targetSheet);
  const headers = rows[0] || [];
  const urlCheck = await checkUrlColumns(targetSheet, rows);

  const sections = [
    {
      heading: "依頼内容の整理",
      lines: summarizeRequest(parsedRequest).split("\n"),
    },
    {
      heading: "シート列",
      lines: headers.length ? headers.map((header) => `- ${header}`) : ["- ヘッダーなし"],
    },
  ];

  if (urlCheck.failedItems.length) {
    const failedLines = [];
    for (const item of urlCheck.failedItems) {
      failedLines.push(`- 行${item.rowNumber} / ${item.columnName}: ${item.originalValue}`);
      failedLines.push(`  ログ: ${item.logs.join(" | ")}`);

      appendErrorLog([
        `[${new Date().toISOString()}] 行${item.rowNumber} / ${item.columnName}`,
        `値: ${item.originalValue}`,
        ...item.logs,
      ]);
    }

    sections.push({
      heading: "問題が残ったURL",
      lines: failedLines,
    });
  }

  writeStandardSummary({
    logDir: LOG_DIR,
    fileName: "latest-run-summary.md",
    title: "営業リスト作成 自動化サマリー",
    overview: [
      { label: "スプレッドシート", value: meta.properties?.title || spreadsheetId },
      { label: "対象シート", value: targetSheet },
      { label: "列数", value: headers.length },
      { label: "データ行数", value: Math.max(rows.length - 1, 0) },
    ],
    metrics: [
      { label: "URLチェック対象", value: `${urlCheck.checked}件` },
      { label: "URL自動補正", value: `${urlCheck.fixed}件` },
      { label: "URL問題あり", value: `${urlCheck.failed}件` },
    ],
    sections,
  });

  console.log("営業リスト作成の初期解析が完了しました。");
  console.log(`対象スプレッドシート: ${meta.properties?.title || spreadsheetId}`);
  console.log(`対象シート: ${targetSheet}`);
  console.log(`列数: ${headers.length}`);
  console.log(`データ行数: ${Math.max(rows.length - 1, 0)}`);

  if (urlCheck.failedItems.length) {
    console.log("");
    console.log("問題が残ったURLがあります。");
    for (const item of urlCheck.failedItems) {
      console.log(`- 行${item.rowNumber} / ${item.columnName}: ${item.originalValue}`);
      console.log(`  ${item.logs.join(" | ")}`);
    }
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
