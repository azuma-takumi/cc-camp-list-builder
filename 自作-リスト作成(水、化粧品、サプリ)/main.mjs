#!/usr/bin/env node
/**
 * 化粧品・サプリメント・ウォーターサーバー 営業リスト作成
 *
 * シート間の優先度（B列ブランド重複時は npm run dedupe または collect 完了時に低優先側のみ削除）:
 *   TVショッピング > 自社通販 > Yahoo > 楽天 （TVと自社が重複 → TVを残し自社を削除）
 *
 * 推奨の進め方（サプリ・ウォーターを TV で広く取ったあと自社へ）:
 *   node main.mjs --only=tv    # まず TV のみ（QVC ビューティ＋ヘルス、SC コスメ〜サプリ〜ドリンク棚）
 *   node main.mjs --only=own   # 続けて自社通販シート
 *
 * 使い方:
 *   node main.mjs              # 全プラットフォーム収集（TV → 自社 → Yahoo → 楽天）の後、上記優先度で重複行を削除
 *   node main.mjs --only=tv    # TVショッピングシートのみ
 *   node main.mjs --only=tv --phase1-only  # TV・フェーズ1のみ（候補列挙・追記なし）
 *   node main.mjs --only=tv --skip-brand=ブランド名  # フェーズ2で当該名を除外（カンマ複数可）
 *   node main.mjs --only=own   # 自社通販のみ
 *   OWN_LIMIT_PER_CATEGORY=20 node main.mjs --only=own  # 化粧品・サプリ・水を各20件まで（再実行で次の枠へ）
 *   OWN_TOTAL_LIMIT=20 node main.mjs --only=own         # 今回の追記を合計20件で打ち切り（OWN_LIMIT_PER_CATEGORY と併用可）
 *   LIMIT=20 node main.mjs --only=tv                  # TVは今回の追記を最大20件
 *   node main.mjs --only=yahoo # Yahoo!ショッピングのみ
 *   node main.mjs --only=rakuten # 楽天のみ
 */

import { log } from './utils.mjs';
import { scrapeYahoo }   from './scrape-yahoo.mjs';
import { scrapeRakuten } from './scrape-rakuten.mjs';
import { scrapeTv, scrapeOwn, scrapeTvPhase1Only } from './scrape-tv.mjs';
import { dedupeSheetsByBrandPriority } from './dedupe-sheets-by-brand-priority.mjs';
import { writeLatestSummary } from './summary-writer.mjs';

function getOnly() {
  const arg = process.argv.find((a) => a.startsWith('--only='));
  return arg ? arg.split('=')[1].toLowerCase() : 'all';
}

async function main() {
  const only = getOnly();
  const phase1OnlyTv = process.argv.includes('--phase1-only') && only === 'tv';
  const start = Date.now();
  let total = 0;
  let status = 'success';

  log('='.repeat(55));
  log(' 営業リスト作成ツール 起動');
  log(`  コピーシートID: ${process.env.SPREADSHEET_ID || '(.envを確認してください)'}`);
  log('='.repeat(55));

  try {
    if (only === 'all' || only === 'tv') {
      if (phase1OnlyTv) {
        total = await scrapeTvPhase1Only();
      } else {
        total += await scrapeTv();
      }
    }
    if (only === 'all' || only === 'own') {
      total += await scrapeOwn();
    }
    if (only === 'all' || only === 'yahoo') {
      total += await scrapeYahoo();
    }
    if (only === 'all' || only === 'rakuten') {
      total += await scrapeRakuten();
    }
    if (only === 'all') {
      log('\n📑 シート間の企業名重複を整理（TV > 自社 > Yahoo > 楽天）');
      await dedupeSheetsByBrandPriority({ log });
    }
  } catch (err) {
    status = 'error';
    writeLatestSummary({
      title: '営業リスト作成 実行サマリー',
      status,
      overview: [
        { label: '実行モード', value: only },
        { label: 'TVフェーズ1のみ', value: phase1OnlyTv ? 'はい' : 'いいえ' },
      ],
      metrics: [
        { label: '合計追記件数', value: total },
        { label: '経過秒数', value: ((Date.now() - start) / 1000).toFixed(1) },
      ],
      sections: [
        {
          heading: 'エラー',
          lines: [`- ${err.message}`],
        },
      ],
    });
    log(`\n❌ エラー: ${err.message}`);
    process.exit(1);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  writeLatestSummary({
    title: '営業リスト作成 実行サマリー',
    status,
    overview: [
      { label: '実行モード', value: only },
      { label: 'TVフェーズ1のみ', value: phase1OnlyTv ? 'はい' : 'いいえ' },
      { label: 'スプレッドシートID', value: process.env.SPREADSHEET_ID || '(.envを確認してください)' },
    ],
    metrics: [
      { label: '合計追記件数', value: total },
      { label: '経過秒数', value: elapsed },
    ],
    sections: [
      {
        heading: '実行結果',
        lines: [
          `- 完了種別: ${phase1OnlyTv ? 'TVフェーズ1のみ' : '通常実行'}`,
          `- シート間重複整理: ${only === 'all' ? '実施' : '未実施'}`,
        ],
      },
    ],
  });

  log('\n' + '='.repeat(55));
  if (phase1OnlyTv) {
    log(` 完了（TVフェーズ1のみ）候補 ${total} 件・シート追記なし  (${elapsed}秒)`);
  } else {
    log(` 完了 🎉  合計 ${total} 件追記  (${elapsed}秒)`);
  }
  log('='.repeat(55));
}

main();
