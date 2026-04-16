/**
 * 収集スクリプト用: 進捗を stdout と同じ内容でファイルに追記する。
 */
import { appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { log as logStdout } from './utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function formatLocalTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

/**
 * @param {string} [baseName] - ログファイル名の接頭辞
 * @returns {{ log: (msg: string) => void, logPath: string }}
 */
export function createCollectFileLogger(baseName = 'yahoo-collect') {
  const dir = join(__dirname, 'logs');
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, `${baseName}-${formatLocalTimestamp(new Date())}.log`);
  appendFileSync(
    logPath,
    `# ${baseName}\n# started ${new Date().toISOString()}\n\n`,
    'utf8'
  );

  function log(msg) {
    const s = String(msg);
    process.stdout.write(`${s}\n`);
    appendFileSync(logPath, `${s}\n`, 'utf8');
  }

  return { log, logPath };
}

/**
 * ファイルログを付けるか。無効時は utils の log のみ（stdout のみ）。
 * --no-collect-log-file … どの収集スクリプトでもファイルログを出さない
 * envDisableKey で指定した環境変数が 0|false … そのスクリプトだけファイルログを出さない
 *   Yahoo: YAHOO_COLLECT_LOG_FILE（既定）
 *   楽天: RAKUTEN_COLLECT_LOG_FILE
 */
export function maybeCreateCollectFileLogger(
  baseName = 'yahoo-collect',
  envDisableKey = 'YAHOO_COLLECT_LOG_FILE'
) {
  if (process.argv.includes('--no-collect-log-file')) {
    return { log: logStdout, logPath: null };
  }
  const e = process.env[envDisableKey];
  if (e === '0' || e === 'false') {
    return { log: logStdout, logPath: null };
  }
  return createCollectFileLogger(baseName);
}
