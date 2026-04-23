#!/usr/bin/env node

/**
 * save-as-script.mjs — config を scrapers/<名前>.mjs に保存
 *
 * 目的:
 *   - リサーチ対話で組み立てた config を再利用可能なスクリプトにする
 *   - 保存したスクリプトは以下どちらでも実行可能
 *     1) 単独実行: node scrapers/<名前>.mjs
 *     2) 名前指定: node tools/run-scraper.mjs <名前>
 *   - 定期実行(launchd)からも 1) の形で呼ばれる
 *
 * Usage:
 *   # stdin から config JSON を流す
 *   cat config.json | node tools/save-as-script.mjs --name "新宿_居酒屋"
 *
 *   # ファイル指定
 *   node tools/save-as-script.mjs --name "新宿_居酒屋" --config config.json
 *
 *   # 上書き確認なしで保存
 *   node tools/save-as-script.mjs --name "..." --config ... --force
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const SCRAPERS_DIR = join(PROJECT_ROOT, "scrapers");

// ========================================
// ファイル名のサニタイズ
// ========================================

/**
 * 保存用の安全なファイル名に変換
 *
 * - 英数字・日本語・アンダースコア・ハイフンだけ残す
 * - スペースは _ に置換
 * - 先頭末尾の不可視文字はトリム
 */
export function sanitizeScriptName(name) {
  if (!name || typeof name !== "string") {
    throw new Error("--name は必須です");
  }
  const cleaned = name
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_\-]/gu, "")
    .slice(0, 80);
  if (!cleaned) {
    throw new Error(`ファイル名として使える文字が name に含まれていません: "${name}"`);
  }
  return cleaned;
}

// ========================================
// テンプレート生成
// ========================================

function generateScriptContent(config, meta) {
  const header = `#!/usr/bin/env node
/**
 * ${meta.displayName} — 保存済みスクレイパー
 *
 * 生成日時: ${meta.savedAt}
 * モード:   ${config.mode || "(未指定)"}
 * シート名: ${config.sheetName || "(日付で自動生成)"}
 *
 * 実行方法:
 *   node scrapers/${meta.fileName}
 *   node tools/run-scraper.mjs ${meta.scriptName}
 *
 * 設定を変更したいときは、下の config オブジェクトを直接編集してください。
 * (CSSセレクタの調整、件数上限の変更など)
 */
`;

  // config を整形して JS として埋め込む
  const configJs = JSON.stringify(config, null, 2);

  return `${header}
import { runResearch } from "../tools/research.mjs";

export const config = ${configJs};

// 直接実行された場合のみ走らせる(import されただけなら走らない)
const isMain =
  import.meta.url === \`file://\${process.argv[1]}\` ||
  (process.argv[1] && process.argv[1].endsWith("${meta.fileName}"));

if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  runResearch(config, { dryRun })
    .then((result) => {
      console.log("");
      console.log("=== 完了 ===");
      console.log(\`取得: \${result.items.length} 件\`);
      if (!dryRun) {
        console.log(\`書き込み: \${result.written} 件\`);
        console.log(\`スキップ: \${result.skipped} 件\`);
        console.log(\`シート: \${result.sheetName}\`);
      }
    })
    .catch((err) => {
      console.error("Error:", err.message);
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    });
}
`;
}

// ========================================
// 保存処理
// ========================================

export async function saveAsScript(config, options = {}) {
  const { name, force = false, displayName } = options;
  if (!name) throw new Error("name が必要です");

  const scriptName = sanitizeScriptName(name);
  const fileName = `${scriptName}.mjs`;
  const filePath = join(SCRAPERS_DIR, fileName);

  if (!existsSync(SCRAPERS_DIR)) {
    mkdirSync(SCRAPERS_DIR, { recursive: true });
  }

  if (existsSync(filePath) && !force) {
    throw new Error(
      `${filePath} は既に存在します。上書きするには --force を指定してください。`
    );
  }

  const meta = {
    displayName: displayName || name,
    scriptName,
    fileName,
    savedAt: new Date().toISOString(),
  };

  // config に name がなければ displayName を入れておく
  const configToSave = { ...config };
  if (!configToSave.name) configToSave.name = meta.displayName;

  const content = generateScriptContent(configToSave, meta);
  writeFileSync(filePath, content, "utf-8");

  return {
    path: filePath,
    fileName,
    scriptName,
    displayName: meta.displayName,
  };
}

// ========================================
// CLI
// ========================================

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

async function main() {
  const name = getArg("--name");
  const configPath = getArg("--config");
  const displayName = getArg("--display-name");
  const force = hasFlag("--force");

  if (!name) {
    console.error("Usage: node tools/save-as-script.mjs --name <名前> [--config <path>|-] [--force]");
    console.error("");
    console.error("  --name <名前>          保存名(日本語可)");
    console.error("  --config <path>|-      config JSON のパス(- なら stdin)。省略時は stdin");
    console.error("  --display-name <name>  コメント内の表示名(省略時は --name)");
    console.error("  --force                既存ファイルを上書き");
    process.exit(1);
  }

  let configRaw;
  if (!configPath || configPath === "-") {
    configRaw = await readStdin();
  } else {
    configRaw = readFileSync(configPath, "utf-8");
  }

  let config;
  try {
    config = JSON.parse(configRaw);
  } catch (err) {
    console.error("Error: config の JSON パース失敗:", err.message);
    process.exit(1);
  }

  const result = await saveAsScript(config, { name, displayName, force });

  console.log(
    JSON.stringify(
      {
        ok: true,
        path: result.path,
        fileName: result.fileName,
        scriptName: result.scriptName,
        runCommand: `node scrapers/${result.fileName}`,
        runCommandAlt: `node tools/run-scraper.mjs ${result.scriptName}`,
      },
      null,
      2
    )
  );
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("save-as-script.mjs");
if (isMain) {
  main().catch((err) => {
    console.error("Error:", err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  });
}
