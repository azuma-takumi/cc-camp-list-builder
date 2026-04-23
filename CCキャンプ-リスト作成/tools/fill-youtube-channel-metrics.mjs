#!/usr/bin/env node

import { readSheetValues, saveSpreadsheetId, updateRows } from "./lib/sheets.mjs";
import {
  getYoutubeChannelMetricsByUrl,
  getYoutubeQuotaUsageSummary,
  resetYoutubeQuotaUsage,
} from "./lib/youtube-api.mjs";

const SPREADSHEET_ID = "1E7sL6TjDiGWUF77uMAc88XK7OzXXS8wgDgwInI5Ad1c";
const SHEET_NAME = "スポーツ用品業界：メールアドレス";
const WRITER_NAME = "東たくみ";

function findHeaderRow(rows) {
  return rows.findIndex(
    (row) => row[0] === "No" && String(row[1] || "").includes("記入者の名前")
  );
}

async function main() {
  resetYoutubeQuotaUsage();
  saveSpreadsheetId(SPREADSHEET_ID);
  const rows = await readSheetValues(SHEET_NAME, "A:K");
  const headerRowIndex = findHeaderRow(rows);

  if (headerRowIndex === -1) {
    throw new Error("ヘッダー行が見つかりませんでした");
  }

  const targets = rows
    .map((row, index) => ({
      rowNumber: index + 1,
      writer: String(row[1] || "").trim(),
      channelName: String(row[2] || "").trim(),
      youtubeUrl: String(row[5] || "").trim(),
      subscriberCount: String(row[8] || "").trim(),
      latestPublishedAt: String(row[9] || "").trim(),
    }))
    .filter(
      (row, index) =>
        index > headerRowIndex &&
        row.writer === WRITER_NAME &&
        row.youtubeUrl &&
        (!row.subscriberCount || !row.latestPublishedAt)
    );

  let updated = 0;
  let skipped = 0;

  for (const row of targets) {
    const metrics = await getYoutubeChannelMetricsByUrl(row.youtubeUrl);
    if (!metrics) {
      skipped += 1;
      continue;
    }

    const nextSubscriberCount = row.subscriberCount || metrics.subscriberCount;
    const nextLatestPublishedAt = row.latestPublishedAt || metrics.latestVideoPublishedAt;

    if (!nextSubscriberCount && !nextLatestPublishedAt) {
      skipped += 1;
      continue;
    }

    await updateRows(SHEET_NAME, row.rowNumber, 8, [[nextSubscriberCount, nextLatestPublishedAt]]);
    updated += 1;
    console.log(
      `UPDATED row=${row.rowNumber} channel=${row.channelName} subs=${nextSubscriberCount} latest=${nextLatestPublishedAt}`
    );
  }

  console.log(`UPDATED_COUNT=${updated}`);
  console.log(`SKIPPED_COUNT=${skipped}`);
  const quotaSummary = getYoutubeQuotaUsageSummary();
  console.log(`YOUTUBE_ATTEMPTED_UNITS=${quotaSummary.estimatedAttemptedUnits}`);
  console.log(`YOUTUBE_SUCCESSFUL_UNITS=${quotaSummary.estimatedSuccessfulUnits}`);
  console.log(`YOUTUBE_REMAINING_ESTIMATE=${quotaSummary.estimatedRemainingUnits}`);
  console.log(`YOUTUBE_BY_REQUEST=${JSON.stringify(quotaSummary.byRequestType)}`);
  console.log(`YOUTUBE_BY_KEY=${JSON.stringify(quotaSummary.byKeyLabel)}`);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
