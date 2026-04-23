#!/usr/bin/env node

/**
 * list-schedules.mjs — 登録済みの定期実行スケジュールを人間向けに整形表示
 *
 * Usage:
 *   node tools/list-schedules.mjs
 *   node tools/list-schedules.mjs --json
 */

import { listSchedules } from "./schedule.mjs";

const WEEKDAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

function formatSchedule(s) {
  if (!s) return "(不明)";
  if (s.kind === "interval") {
    const h = s.seconds / 3600;
    const m = s.seconds / 60;
    if (h >= 1 && Number.isInteger(h)) return `${h}時間ごと`;
    if (m >= 1 && Number.isInteger(m)) return `${m}分ごと`;
    return `${s.seconds}秒ごと`;
  }
  if (s.kind === "calendar" && Array.isArray(s.entries)) {
    return s.entries
      .map((e) => {
        const hh = String(e.Hour ?? 0).padStart(2, "0");
        const mm = String(e.Minute ?? 0).padStart(2, "0");
        const when =
          e.Weekday != null ? `毎週${WEEKDAY_NAMES[e.Weekday]} ${hh}:${mm}` : `毎日 ${hh}:${mm}`;
        return when;
      })
      .join(" / ");
  }
  return "(不明)";
}

function main() {
  const json = process.argv.includes("--json");
  const items = listSchedules();

  if (json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log("登録済みの定期実行はありません。");
    return;
  }

  console.log(`登録済みスケジュール (${items.length}件):`);
  console.log("");
  for (const it of items) {
    console.log(`- ${it.scriptName}`);
    console.log(`    スケジュール: ${formatSchedule(it.schedule)}`);
    console.log(`    スクリプト:   ${it.scraperPath || "(見つかりません)"}`);
    console.log(`    plist:        ${it.plistPath}`);
    console.log("");
  }
  console.log(
    "削除: node tools/schedule.mjs --name <名前> --remove"
  );
}

main();
