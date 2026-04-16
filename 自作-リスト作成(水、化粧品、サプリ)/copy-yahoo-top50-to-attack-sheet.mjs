#!/usr/bin/env node
/**
 * メイン「3.Yahoo」を上から走査し、アタックにまだ無い店だけを最大 N 件 → アタック「3.Yahoo」へ追記（A〜E。F列はコピーしない）
 *   node copy-yahoo-top50-to-attack-sheet.mjs           # 既定 50 件
 *   node copy-yahoo-top50-to-attack-sheet.mjs --max=200
 */
import { copyMainSheetToAttackList } from './attack-list-copy.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

function getMaxAppendRows() {
  const a = process.argv.find((x) => x.startsWith('--max='));
  if (!a) return 50;
  const n = Number(a.slice('--max='.length));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 50;
}

copyMainSheetToAttackList('yahoo', { maxAppendRows: getMaxAppendRows() }).catch((e) => {
  console.error(e);
  process.exit(1);
});
