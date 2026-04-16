#!/usr/bin/env node

import { join } from "path";
import {
  appendRows,
  createSpreadsheet,
  readSheetValues,
  saveSpreadsheetId,
  toColumnLetter,
  updateCell,
} from "./lib/sheets.mjs";
import { validateAndRepairUrl } from "./lib/url-checker.mjs";
import { appendDatedLog, writeStandardSummary } from "./lib/summary-writer.mjs";

const LOG_DIR = new URL("../logs/", import.meta.url).pathname;

const DEMO_COMPANIES = [
  {
    companyName: "株式会社ネオインデックス",
    siteUrl: "www.neoindex.co.jp",
    address: "東京都豊島区東池袋1-17-8 NBF池袋シティビル2F",
    phone: "03-5956-2811",
    source: "WebSearchで確認した参考企業",
  },
  {
    companyName: "株式会社LIG",
    siteUrl: "liginc.co.jp",
    address: "東京都台東区小島2-20-11",
    phone: "03-6240-1253",
    source: "WebSearchで確認した参考企業",
  },
  {
    companyName: "株式会社メンバーズ",
    siteUrl: "www.members.co.jp",
    address: "東京都中央区晴海1-8-10",
    phone: "03-5144-0660",
    source: "WebSearchで確認した参考企業",
  },
  {
    companyName: "株式会社キノトロープ",
    siteUrl: "www.kinotrope.co.jp",
    address: "東京都渋谷区大山町45-14",
    phone: "03-5478-8440",
    source: "WebSearchで確認した参考企業",
  },
  {
    companyName: "株式会社センタード",
    siteUrl: "www.centered.co.jp",
    address: "東京都新宿区西新宿7-5-8 GOWA西新宿8F",
    phone: "03-5937-5864",
    source: "WebSearchで確認した参考企業",
  },
];

function appendErrorLog(lines) {
  appendDatedLog({ logDir: LOG_DIR, prefix: "run", lines });
}

async function checkUrlColumns(sheetName, rows) {
  const headers = rows[0] || [];
  const dataRows = rows.slice(1);
  const urlColumnIndexes = headers
    .map((header, index) => ({ header: String(header || ""), index }))
    .filter((item) => /url|サイト|ホームページ|link|リンク/i.test(item.header));

  const result = {
    checked: 0,
    fixed: 0,
    failed: 0,
    failedItems: [],
  };

  for (let rowOffset = 0; rowOffset < dataRows.length; rowOffset += 1) {
    const row = dataRows[rowOffset];
    const rowNumber = rowOffset + 2;

    for (const column of urlColumnIndexes) {
      const value = row[column.index] || "";
      if (!String(value).trim()) {
        continue;
      }

      result.checked += 1;
      const checked = await validateAndRepairUrl(value);

      if (checked.status === "fixed" && checked.finalValue !== value) {
        await updateCell(sheetName, `${toColumnLetter(column.index)}${rowNumber}`, checked.finalValue);
        result.fixed += 1;
      }

      if (checked.status === "error") {
        result.failed += 1;
        result.failedItems.push({
          rowNumber,
          columnName: column.header,
          value,
          logs: checked.logs,
        });
      }
    }
  }

  return result;
}

async function main() {
  const sheetTitle = `営業リストテスト ${new Date().toISOString().slice(0, 10)}`;
  const sheetName = "営業リスト";

  const created = await createSpreadsheet(sheetTitle, sheetName, 6);
  saveSpreadsheetId(created.spreadsheetId);

  const header = [["会社名", "企業URL", "住所", "電話番号", "情報元", "備考"]];
  const body = DEMO_COMPANIES.map((company) => [
    company.companyName,
    company.siteUrl,
    company.address,
    company.phone,
    company.source,
    "テスト用5件",
  ]);

  await appendRows(sheetName, header);
  await appendRows(sheetName, body);

  const rows = await readSheetValues(sheetName);
  const urlCheck = await checkUrlColumns(sheetName, rows);

  const sections = [
    {
      heading: "登録した会社",
      lines: DEMO_COMPANIES.map((company) => `- ${company.companyName}`),
    },
  ];

  if (urlCheck.failedItems.length) {
    const failedLines = [];
    for (const item of urlCheck.failedItems) {
      failedLines.push(`- 行${item.rowNumber} / ${item.columnName}: ${item.value}`);
      failedLines.push(`  ログ: ${item.logs.join(" | ")}`);
      appendErrorLog([
        `[${new Date().toISOString()}] 行${item.rowNumber} / ${item.columnName}`,
        `値: ${item.value}`,
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
    fileName: "test-sales-list-summary.md",
    title: "営業リストテスト結果",
    overview: [
      { label: "スプレッドシートURL", value: created.spreadsheetUrl },
      { label: "登録件数", value: `${DEMO_COMPANIES.length}件` },
    ],
    metrics: [
      { label: "URLチェック対象", value: `${urlCheck.checked}件` },
      { label: "URL自動補正", value: `${urlCheck.fixed}件` },
      { label: "URL問題あり", value: `${urlCheck.failed}件` },
    ],
    sections,
  });

  console.log(`SPREADSHEET_ID=${created.spreadsheetId}`);
  console.log(`SPREADSHEET_URL=${created.spreadsheetUrl}`);
  console.log(`ROWS=${DEMO_COMPANIES.length}`);
  console.log(`URL_CHECKED=${urlCheck.checked}`);
  console.log(`URL_FIXED=${urlCheck.fixed}`);
  console.log(`URL_FAILED=${urlCheck.failed}`);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
