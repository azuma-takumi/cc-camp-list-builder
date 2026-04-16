#!/usr/bin/env node
/**
 * メイン「2.自社通販」→ アタック「2.自社通販」（全データ行・ヘッダ除く）。
 * 既にアタックにあるブランドは B列キー一致で A:D をメインに同期（リンク修正の反映）、未登録のみ追記。
 * ルートは attack-spreadsheet-config.mjs の ATTACK_LIST_COPY_ROUTES。
 */
import { copyMainSheetToAttackList } from './attack-list-copy.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

copyMainSheetToAttackList('own').catch((e) => {
  console.error(e);
  process.exit(1);
});
