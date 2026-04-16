#!/usr/bin/env node

import { join } from "path";
import {
  readSheetValues,
  saveSpreadsheetId,
  toColumnLetter,
  updateCell,
  updateRows,
} from "./lib/sheets.mjs";
import { validateAndRepairUrl } from "./lib/url-checker.mjs";
import { appendDatedLog, writeStandardSummary } from "./lib/summary-writer.mjs";

const SPREADSHEET_ID = "1E7sL6TjDiGWUF77uMAc88XK7OzXXS8wgDgwInI5Ad1c";
const SHEET_NAME = "スポーツ用品業界：メールアドレス";
const WRITER_NAME = "東たくみ";
const LOG_DIR = new URL("../logs/", import.meta.url).pathname;
const TEST_ROWS = [
  {
    channelName: "スポーツマーケットJP",
    companyName: "株式会社スポーツマーケットJP",
    representativeName: "山田 健太",
    youtubeUrl: "www.youtube.com/@sportsmarketjp",
    email: "info@sportsmarketjp.jp",
    emailSource: "公式サイト",
    subscribers: "2450",
    lastPostedAt: "2026-03-28",
    fetchedAt: "2026-04-11",
  },
  {
    channelName: "RUN&FIT TOKYO",
    companyName: "合同会社RUN&FIT TOKYO",
    representativeName: "佐藤 美咲",
    youtubeUrl: "youtube.com/@runandfittokyo",
    email: "contact@runfit.tokyo",
    emailSource: "公式サイト",
    subscribers: "980",
    lastPostedAt: "2026-03-15",
    fetchedAt: "2026-04-11",
  },
  {
    channelName: "アスリートギア通信",
    companyName: "株式会社アスリートギア",
    representativeName: "中村 翔",
    youtubeUrl: "www.youtube.com/@athletegearnews",
    email: "support@athletegear.co.jp",
    emailSource: "YouTube概要欄",
    subscribers: "5300",
    lastPostedAt: "2026-04-01",
    fetchedAt: "2026-04-11",
  },
  {
    channelName: "Sports Base Lab",
    companyName: "Sports Base Lab株式会社",
    representativeName: "",
    youtubeUrl: "youtube.com/@sportsbaselab",
    email: "hello@sportsbaselab.jp",
    emailSource: "公式サイト",
    subscribers: "410",
    lastPostedAt: "2026-02-09",
    fetchedAt: "2026-04-11",
  },
  {
    channelName: "Outdoor Pro Channel",
    companyName: "株式会社Outdoor Pro",
    representativeName: "高橋 悠人",
    youtubeUrl: "www.youtube.com/@outdoorprochannel",
    email: "sales@outdoorpro.jp",
    emailSource: "公式サイト",
    subscribers: "15800",
    lastPostedAt: "2026-03-30",
    fetchedAt: "2026-04-11",
  },
];

function appendErrorLog(lines) {
  appendDatedLog({ logDir: LOG_DIR, prefix: "run", lines });
}

function findHeaderRow(rows) {
  return rows.findIndex(
    (row) => row[0] === "No" && String(row[1] || "").includes("記入者の名前")
  );
}

function findStartRow(rows, headerRowIndex) {
  let lastFilledRowNumber = headerRowIndex + 1;

  for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
    const writerName = String(rows[index]?.[1] || "").trim();
    if (writerName) {
      lastFilledRowNumber = index + 1;
    }
  }

  return lastFilledRowNumber + 1;
}

async function checkYoutubeUrlColumn(startRowNumber, rowCount) {
  const result = {
    checked: 0,
    fixed: 0,
    failed: 0,
    failedItems: [],
  };

  for (let offset = 0; offset < rowCount; offset += 1) {
    const rowNumber = startRowNumber + offset;
    const checked = await validateAndRepairUrl(TEST_ROWS[offset].youtubeUrl);
    result.checked += 1;

    if (checked.status === "fixed" && checked.finalValue !== TEST_ROWS[offset].youtubeUrl) {
      await updateCell(SHEET_NAME, `${toColumnLetter(5)}${rowNumber}`, checked.finalValue);
      result.fixed += 1;
    }

    if (checked.status === "error") {
      result.failed += 1;
      result.failedItems.push({
        rowNumber,
        value: TEST_ROWS[offset].youtubeUrl,
        logs: checked.logs,
      });
    }
  }

  return result;
}

async function main() {
  saveSpreadsheetId(SPREADSHEET_ID);
  const rows = await readSheetValues(SHEET_NAME, "A:K");
  const headerRowIndex = findHeaderRow(rows);

  if (headerRowIndex === -1) {
    throw new Error("ヘッダー行が見つかりませんでした");
  }

  const startRow = findStartRow(rows, headerRowIndex);
  const preparedRows = TEST_ROWS.map((item, index) => [
    String(startRow - (headerRowIndex + 1) + index),
    WRITER_NAME,
    item.channelName,
    item.companyName,
    item.representativeName,
    item.youtubeUrl,
    item.email,
    item.emailSource,
    item.subscribers,
    item.lastPostedAt,
    item.fetchedAt,
  ]);

  await updateRows(SHEET_NAME, startRow, 0, preparedRows);
  const urlCheck = await checkYoutubeUrlColumn(startRow, TEST_ROWS.length);

  const sections = [];

  if (urlCheck.failedItems.length) {
    const failedLines = [];
    for (const item of urlCheck.failedItems) {
      failedLines.push(`- 行${item.rowNumber}: ${item.value}`);
      failedLines.push(`  ログ: ${item.logs.join(" | ")}`);
      appendErrorLog([
        `[${new Date().toISOString()}] 行${item.rowNumber} / YouTubeチャンネルURL`,
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
    fileName: "crowdworks-test-summary.md",
    title: "CrowdWorksシート投入テスト",
    overview: [
      { label: "対象シート", value: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit` },
      { label: "対象タブ", value: SHEET_NAME },
      { label: "開始行", value: startRow },
      { label: "投入件数", value: `${TEST_ROWS.length}件` },
    ],
    metrics: [
      { label: "URLチェック対象", value: `${urlCheck.checked}件` },
      { label: "URL自動補正", value: `${urlCheck.fixed}件` },
      { label: "URL問題あり", value: `${urlCheck.failed}件` },
    ],
    sections,
  });

  console.log(`START_ROW=${startRow}`);
  console.log(`ROWS=${TEST_ROWS.length}`);
  console.log(`URL_CHECKED=${urlCheck.checked}`);
  console.log(`URL_FIXED=${urlCheck.fixed}`);
  console.log(`URL_FAILED=${urlCheck.failed}`);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
