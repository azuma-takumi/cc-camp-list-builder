#!/usr/bin/env node

import { readSheetValues, saveSpreadsheetId, updateCell } from "./lib/sheets.mjs";
import { validateAndRepairUrl } from "./lib/url-checker.mjs";

const SPREADSHEET_ID = "1E7sL6TjDiGWUF77uMAc88XK7OzXXS8wgDgwInI5Ad1c";
const SHEET_NAME = "スポーツ用品業界：メールアドレス";
const START_ROW = 13;
const END_ROW = 17;
const URL_COLUMN_INDEX = 5;

async function main() {
  saveSpreadsheetId(SPREADSHEET_ID);
  const rows = await readSheetValues(SHEET_NAME, `A${START_ROW}:K${END_ROW}`);

  for (let index = 0; index < rows.length; index += 1) {
    const rowNumber = START_ROW + index;
    const rawValue = rows[index]?.[URL_COLUMN_INDEX] || "";
    const checked = await validateAndRepairUrl(rawValue);

    if (checked.finalValue && checked.finalValue !== rawValue) {
      await updateCell(SHEET_NAME, `F${rowNumber}`, checked.finalValue);
    }

    console.log(
      JSON.stringify({
        rowNumber,
        rawValue,
        status: checked.status,
        finalValue: checked.finalValue,
        logs: checked.logs,
      })
    );
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
