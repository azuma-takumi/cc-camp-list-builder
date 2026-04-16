#!/usr/bin/env node
/**
 * メイン「1.TVショッピング」→ アタック「1.TVショッピング」のみ（同名タブ同士）。
 * ルートは attack-spreadsheet-config.mjs の ATTACK_LIST_COPY_ROUTES。
 */
import { copyMainSheetToAttackList } from './attack-list-copy.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

copyMainSheetToAttackList('tv').catch((e) => {
  console.error(e);
  process.exit(1);
});
