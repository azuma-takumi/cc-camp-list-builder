#!/usr/bin/env node

import { readSheetValues, saveSpreadsheetId, updateRows } from "./lib/sheets.mjs";
import { getYoutubeChannelMetricsByUrl } from "./lib/youtube-api.mjs";

const SPREADSHEET_ID = "1E7sL6TjDiGWUF77uMAc88XK7OzXXS8wgDgwInI5Ad1c";
const SHEET_NAME = "スポーツ用品業界：メールアドレス";

// `updateRows()` expects a zero-based column index.
// F列=YouTubeチャンネルURL, G列=メールアドレス
const YOUTUBE_URL_COLUMN_INDEX = 5;

function shouldProcessUrl(url) {
  return /^https?:\/\/www\.youtube\.com\//i.test(String(url || "").trim());
}

async function main() {
  saveSpreadsheetId(SPREADSHEET_ID);

  const startRow = Number(process.env.START_ROW || "1");
  const endRow = Number(process.env.END_ROW || "9999");
  const onlyNonAscii = process.env.ONLY_NON_ASCII === "1";

  const rows = await readSheetValues(SHEET_NAME, `A${startRow}:K${endRow}`);
  const updates = [];

  for (let offset = 0; offset < rows.length; offset += 1) {
    const rowNumber = startRow + offset;
    const row = rows[offset] || [];
    const currentUrl = String(row[5] || "").trim();

    if (!shouldProcessUrl(currentUrl)) {
      continue;
    }
    if (onlyNonAscii && !/[^\x00-\x7F]/.test(currentUrl)) {
      continue;
    }

    const metrics = await getYoutubeChannelMetricsByUrl(currentUrl);
    if (!metrics?.channelId) {
      continue;
    }

    const nextUrl = `https://www.youtube.com/channel/${metrics.channelId}`;
    if (nextUrl === currentUrl) {
      continue;
    }

    await updateRows(SHEET_NAME, rowNumber, YOUTUBE_URL_COLUMN_INDEX, [[nextUrl]]);
    updates.push({
      rowNumber,
      channelName: String(row[2] || "").trim(),
      before: currentUrl,
      after: nextUrl,
    });
    console.log(`UPDATED row=${rowNumber} ${currentUrl} -> ${nextUrl}`);
  }

  console.log(`UPDATED_COUNT=${updates.length}`);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
