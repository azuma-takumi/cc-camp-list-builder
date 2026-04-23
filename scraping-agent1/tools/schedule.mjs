#!/usr/bin/env node

/**
 * schedule.mjs — macOS launchd に定期実行を登録 / 削除
 *
 * 前提: 保存済みスクレイパー(scrapers/<名前>.mjs)が存在すること。
 *
 * Usage:
 *   # 毎日9時に実行
 *   node tools/schedule.mjs --name "新宿_居酒屋" --daily 09:00
 *
 *   # 毎週月曜9時に実行(曜日は sun/mon/tue/wed/thu/fri/sat)
 *   node tools/schedule.mjs --name "..." --weekly mon=09:00
 *
 *   # 60分ごとに実行
 *   node tools/schedule.mjs --name "..." --every-hours 1
 *
 *   # 300秒ごと(テスト用)
 *   node tools/schedule.mjs --name "..." --interval-sec 300
 *
 *   # 削除
 *   node tools/schedule.mjs --name "..." --remove
 *
 *   # スケジュールを再登録したい(上書き)
 *   node tools/schedule.mjs --name "..." --daily 10:00 --force
 *
 *   # plist の内容だけ確認(ファイルは作らない)
 *   node tools/schedule.mjs --name "..." --daily 09:00 --dry-run
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
} from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { execSync, execFileSync } from "child_process";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const SCRAPERS_DIR = join(PROJECT_ROOT, "scrapers");

// launchd ラベルのプレフィックス。.env の LAUNCHD_LABEL_PREFIX で上書き可能。
// 実際に作られる plist は `<LABEL_PREFIX>.<スクリプト名>.plist` という形式になる。
const LABEL_PREFIX = process.env.LAUNCHD_LABEL_PREFIX || "local.scraping-agent";
const LAUNCH_AGENTS_DIR = join(homedir(), "Library", "LaunchAgents");
const LOG_DIR = join(homedir(), "Library", "Logs", "scraping-agent");

// ========================================
// 共通ユーティリティ
// ========================================

function hasFlag(name) {
  return process.argv.includes(name);
}

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

function resolveNodePath() {
  try {
    const out = execSync("which node", { encoding: "utf-8" }).trim();
    if (out) return out;
  } catch {
    // ignore
  }
  return process.execPath; // 現在のNodeのフルパス
}

function buildLabel(scriptName) {
  return `${LABEL_PREFIX}.${scriptName}`;
}

function buildPlistPath(scriptName) {
  return join(LAUNCH_AGENTS_DIR, `${buildLabel(scriptName)}.plist`);
}

function buildLogPath(scriptName) {
  return {
    stdout: join(LOG_DIR, `${scriptName}.log`),
    stderr: join(LOG_DIR, `${scriptName}.err.log`),
  };
}

function resolveScraperPath(name) {
  const candidate = join(SCRAPERS_DIR, `${name}.mjs`);
  if (existsSync(candidate)) return candidate;
  return null;
}

// ========================================
// スケジュール指定のパース
// ========================================

const WEEKDAY_MAP = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/**
 * CLIフラグからスケジュールオプションを抽出
 * 返り値: plist に入れるスケジュール設定 or null
 */
function parseScheduleFromArgs() {
  const daily = getArg("--daily");
  const weekly = getArg("--weekly");
  const everyHours = getArg("--every-hours");
  const intervalSec = getArg("--interval-sec");

  const specified = [daily, weekly, everyHours, intervalSec].filter(Boolean);
  if (specified.length > 1) {
    throw new Error(
      "スケジュール指定は1つだけにしてください(--daily / --weekly / --every-hours / --interval-sec)"
    );
  }

  if (daily) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(daily);
    if (!m) throw new Error(`--daily は HH:MM 形式で指定: ${daily}`);
    return {
      kind: "calendar",
      display: `毎日 ${daily}`,
      entries: [{ Hour: parseInt(m[1], 10), Minute: parseInt(m[2], 10) }],
    };
  }

  if (weekly) {
    const m = /^(sun|mon|tue|wed|thu|fri|sat)=(\d{1,2}):(\d{2})$/i.exec(weekly);
    if (!m) {
      throw new Error(
        `--weekly は <曜日>=HH:MM 形式で指定(曜日: sun|mon|tue|wed|thu|fri|sat): ${weekly}`
      );
    }
    const wd = WEEKDAY_MAP[m[1].toLowerCase()];
    return {
      kind: "calendar",
      display: `毎週${m[1].toLowerCase()} ${m[2]}:${m[3]}`,
      entries: [{ Weekday: wd, Hour: parseInt(m[2], 10), Minute: parseInt(m[3], 10) }],
    };
  }

  if (everyHours) {
    const hrs = parseFloat(everyHours);
    if (!(hrs > 0)) throw new Error(`--every-hours は正の数で指定: ${everyHours}`);
    return {
      kind: "interval",
      display: `${hrs}時間ごと`,
      seconds: Math.round(hrs * 3600),
    };
  }

  if (intervalSec) {
    const sec = parseInt(intervalSec, 10);
    if (!(sec > 0)) throw new Error(`--interval-sec は正の整数で指定: ${intervalSec}`);
    return {
      kind: "interval",
      display: `${sec}秒ごと`,
      seconds: sec,
    };
  }

  return null;
}

// ========================================
// plist 生成
// ========================================

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPlist({ label, nodePath, scraperPath, logPaths, schedule }) {
  const programArgs = [nodePath, scraperPath]
    .map((a) => `    <string>${escapeXml(a)}</string>`)
    .join("\n");

  let scheduleXml = "";
  if (schedule.kind === "interval") {
    scheduleXml = `  <key>StartInterval</key>
  <integer>${schedule.seconds}</integer>`;
  } else if (schedule.kind === "calendar") {
    if (schedule.entries.length === 1) {
      const entry = schedule.entries[0];
      const lines = Object.entries(entry)
        .map(([k, v]) => `    <key>${k}</key>\n    <integer>${v}</integer>`)
        .join("\n");
      scheduleXml = `  <key>StartCalendarInterval</key>
  <dict>
${lines}
  </dict>`;
    } else {
      const arrayBody = schedule.entries
        .map((entry) => {
          const lines = Object.entries(entry)
            .map(([k, v]) => `      <key>${k}</key>\n      <integer>${v}</integer>`)
            .join("\n");
          return `    <dict>\n${lines}\n    </dict>`;
        })
        .join("\n");
      scheduleXml = `  <key>StartCalendarInterval</key>
  <array>
${arrayBody}
  </array>`;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(PROJECT_ROOT)}</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPaths.stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPaths.stderr)}</string>
  <key>RunAtLoad</key>
  <false/>
${scheduleXml}
</dict>
</plist>
`;
}

// ========================================
// launchctl 操作
// ========================================

function launchctlLoad(plistPath) {
  try {
    // 念のためunloadしてからload(既存ジョブを上書きする想定)
    execFileSync("launchctl", ["unload", plistPath], { stdio: "ignore" });
  } catch {
    // 未ロードなら失敗するが無視
  }
  execFileSync("launchctl", ["load", "-w", plistPath], { stdio: "inherit" });
}

function launchctlUnload(plistPath) {
  try {
    execFileSync("launchctl", ["unload", "-w", plistPath], { stdio: "inherit" });
  } catch (err) {
    // すでにアンロード済みなら無視
    if (process.env.DEBUG) console.error(err);
  }
}

// ========================================
// 登録済み一覧
// ========================================

export function listSchedules() {
  if (!existsSync(LAUNCH_AGENTS_DIR)) return [];
  return readdirSync(LAUNCH_AGENTS_DIR)
    .filter((f) => f.startsWith(`${LABEL_PREFIX}.`) && f.endsWith(".plist"))
    .map((f) => {
      const scriptName = f.slice(LABEL_PREFIX.length + 1, -".plist".length);
      const path = join(LAUNCH_AGENTS_DIR, f);
      let schedule = null;
      try {
        const content = readFileSync(path, "utf-8");
        schedule = parseScheduleFromPlist(content);
      } catch {
        // ignore
      }
      return {
        scriptName,
        label: `${LABEL_PREFIX}.${scriptName}`,
        plistPath: path,
        scraperPath: resolveScraperPath(scriptName),
        schedule,
      };
    });
}

function parseScheduleFromPlist(content) {
  // 非常にざっくりしたパーサー(検証済み自前plist前提)
  const intervalMatch = /<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/.exec(content);
  if (intervalMatch) {
    return { kind: "interval", seconds: parseInt(intervalMatch[1], 10) };
  }
  if (content.includes("<key>StartCalendarInterval</key>")) {
    const dict = /<dict>([\s\S]*?)<\/dict>/g;
    // 最初の dict は plist 全体。2番目以降を拾う
    const dicts = [];
    let m;
    while ((m = dict.exec(content))) dicts.push(m[1]);
    const entries = dicts
      .slice(1)
      .map((body) => {
        const entry = {};
        const re = /<key>(Hour|Minute|Weekday|Month|Day)<\/key>\s*<integer>(\d+)<\/integer>/g;
        let km;
        while ((km = re.exec(body))) entry[km[1]] = parseInt(km[2], 10);
        return entry;
      })
      .filter((e) => Object.keys(e).length > 0);
    return { kind: "calendar", entries };
  }
  return null;
}

// ========================================
// 登録 / 削除
// ========================================

export async function scheduleAdd({ scriptName, schedule, force = false, dryRun = false }) {
  const scraperPath = resolveScraperPath(scriptName);
  if (!scraperPath) {
    throw new Error(
      `scrapers/${scriptName}.mjs が存在しません。先に save-as-script で保存してください。`
    );
  }

  const label = buildLabel(scriptName);
  const plistPath = buildPlistPath(scriptName);
  const logPaths = buildLogPath(scriptName);
  const nodePath = resolveNodePath();

  if (existsSync(plistPath) && !force) {
    throw new Error(
      `${plistPath} は既に存在します(=既にスケジュール登録済み)。上書きするには --force を指定してください。`
    );
  }

  const plistContent = buildPlist({ label, nodePath, scraperPath, logPaths, schedule });

  if (dryRun) {
    return { dryRun: true, plistPath, plistContent, logPaths, label, scraperPath };
  }

  if (!existsSync(LAUNCH_AGENTS_DIR)) mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  writeFileSync(plistPath, plistContent, "utf-8");
  launchctlLoad(plistPath);

  return { dryRun: false, plistPath, logPaths, label, scraperPath, schedule };
}

export async function scheduleRemove({ scriptName }) {
  const plistPath = buildPlistPath(scriptName);
  if (!existsSync(plistPath)) {
    throw new Error(`${plistPath} が存在しません(=スケジュール未登録)`);
  }
  launchctlUnload(plistPath);
  unlinkSync(plistPath);
  return { plistPath, removed: true };
}

// ========================================
// CLI
// ========================================

async function main() {
  const name = getArg("--name");
  const remove = hasFlag("--remove");
  const force = hasFlag("--force");
  const dryRun = hasFlag("--dry-run");
  const listOnly = hasFlag("--list");

  if (listOnly) {
    const items = listSchedules();
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  if (!name) {
    console.error("Usage:");
    console.error("  node tools/schedule.mjs --name <名前> --daily HH:MM");
    console.error("  node tools/schedule.mjs --name <名前> --weekly <曜日>=HH:MM");
    console.error("  node tools/schedule.mjs --name <名前> --every-hours N");
    console.error("  node tools/schedule.mjs --name <名前> --interval-sec N");
    console.error("  node tools/schedule.mjs --name <名前> --remove");
    console.error("  node tools/schedule.mjs --list");
    process.exit(1);
  }

  if (remove) {
    const res = await scheduleRemove({ scriptName: name });
    console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    return;
  }

  const schedule = parseScheduleFromArgs();
  if (!schedule) {
    console.error("Error: スケジュールを指定してください(--daily / --weekly / --every-hours / --interval-sec)");
    process.exit(1);
  }

  const res = await scheduleAdd({ scriptName: name, schedule, force, dryRun });

  if (dryRun) {
    console.log("=== dry-run: plist 内容 ===");
    console.log(res.plistContent);
    console.log("");
    console.log(`保存先(登録時): ${res.plistPath}`);
    console.log(`ログ(stdout):   ${res.logPaths.stdout}`);
    console.log(`ログ(stderr):   ${res.logPaths.stderr}`);
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        scriptName: name,
        label: res.label,
        plistPath: res.plistPath,
        schedule: { display: schedule.display, ...schedule },
        logPaths: res.logPaths,
      },
      null,
      2
    )
  );
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("schedule.mjs");
if (isMain) {
  main().catch((err) => {
    console.error("Error:", err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  });
}
