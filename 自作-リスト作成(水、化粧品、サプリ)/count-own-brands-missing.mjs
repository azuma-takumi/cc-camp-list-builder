#!/usr/bin/env node
/**
 * OWN_BRANDS のうち、2.自社通販 の C列にまだ載っていない件数を表示
 * （scrapeOwn と同じく URL 一致で判定）
 */
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { OWN_BRANDS } from './scrape-tv.mjs';
import { getExistingUrls, getExistingNames } from './sheets.mjs';
import { normalizeBrandNameKey } from './utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const OWN_SHEET = '2.自社通販';

const SUPPORTED = new Set(['化粧品', 'サプリメント', 'ウォーターサーバー']);

async function main() {
  const existingUrls = await getExistingUrls(OWN_SHEET);
  const existingNames = await getExistingNames(OWN_SHEET);

  const eligible = OWN_BRANDS.filter((b) => SUPPORTED.has(b.category));
  const missingByUrl = eligible.filter((b) => !existingUrls.has(b.url));
  const missingByName = eligible.filter((b) => !existingNames.has(normalizeBrandNameKey(b.name)));

  console.log(`【${OWN_SHEET}】`);
  console.log(`  OWN_BRANDS 対象（化粧品・サプリ・水）: ${eligible.length} 件`);
  console.log(`  C列に同一URLなし → 未追加（URL基準）: ${missingByUrl.length} 件`);
  console.log(`  B列に同一企業名なし（名前基準）: ${missingByName.length} 件`);
  console.log('');
  console.log('※ 実際の追記は scrapeOwn が「問い合わせ取得できる」場合のみ。URL基準の未追加一覧:');
  for (const b of missingByUrl) {
    const hasContact = Boolean(String(b.contact || '').trim());
    console.log(`  - [${b.category}] ${b.name}  ${hasContact ? '（contact既定あり）' : '（contact空・取得試行）'}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
