#!/usr/bin/env node
/**
 * メイン「3.Yahoo」→ アタック「3.Yahoo」のみ（A〜E。F列はコピーしない）。
 * ルート定義は attack-spreadsheet-config.mjs の ATTACK_LIST_COPY_ROUTES.yahoo を参照。
 */
import { copyMainSheetToAttackList } from './attack-list-copy.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

copyMainSheetToAttackList('yahoo').catch((e) => {
  console.error(e);
  process.exit(1);
});
