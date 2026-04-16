/**
 * 楽天市場 店舗収集
 *
 * 店舗IDの列挙:
 * - .env に RAKUTEN_APPLICATION_ID（必須）と RAKUTEN_ACCESS_KEY（推奨）がある場合は
 *   楽天ウェブサービス「商品検索API」で取得（HTML検索より安定・高速）
 * - 未設定時は従来どおり search.rakuten.co.jp の HTML から抽出
 *
 * 連絡先は各ショップのトップ / info ページから取得（API では取得しない）。
 * ショップ名は会社概要 info.html を優先（【楽天市場】…[会社概要] タイトル等。euc-jp 対応）。
 *
 * 同一店でもカテゴリごとに別行（自社のファンケル / ファンケル サプリと同様。B列はサプリ・ウォーターで接尾辞）。
 * 重複判定は C列URL＋A列カテゴリ。
 * F列: その店を初めて拾った検索クエリ（Eはメール用で未使用のとき空）。
 *
 * 収集ログは既定で ./logs/rakuten-collect-日時.log にも出力（--no-collect-log-file または RAKUTEN_COLLECT_LOG_FILE=0 でオフ）
 */

import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  fetchHtml,
  fetchRakutenHtml,
  extractRakutenStoreNameFromInfoHtml,
  parseRakutenShopTopTitle,
  delay,
  shopDisplayNameForMarketplaceCategory,
  urlCategoryDuplicateKey,
} from './utils.mjs';
import { maybeCreateCollectFileLogger } from './collect-log.mjs';
import { appendRows, getExistingUrlCategoryKeys } from './sheets.mjs';
import { isRakutenWebServiceConfigured, fetchShopCodesFromItemSearch, fetchShopItemCountForVerify } from './rakuten-webservice.mjs';
import { writeLatestSummary } from './summary-writer.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEET_NAME = '4.Rakutenn';

const SEARCHES = [
  { category: '化粧品', queries: [
    '化粧品', 'スキンケア 化粧水', 'コスメ 美容液', '洗顔料 泡洗顔',
    '日焼け止め UV', '化粧水 乳液', '美容クリーム 保湿', 'マスクパック フェイスマスク',
    '美白 スキンケア', 'エイジングケア 化粧品', '敏感肌 スキンケア', 'オールインワン ゲル',
    'BB クリーム ファンデーション', 'アイクリーム 目元', 'ネイルケア 美爪',
  ]},
  { category: 'サプリメント', queries: [
    'サプリメント', '健康食品 ビタミン', 'プロテイン サプリ', 'コラーゲン サプリ',
    'ヒアルロン酸 サプリ', '乳酸菌 腸活', 'ビタミンC 美容', '葉酸 サプリ',
    'アミノ酸 サプリ', '鉄分 サプリ', 'マルチビタミン ミネラル', '酵素 ダイエット',
    '青汁 健康', 'DHA EPA サプリ', 'プロバイオティクス 善玉菌',
  ]},
  { category: 'ウォーターサーバー', queries: [
    'ウォーターサーバー', '宅配水 ウォーター', '天然水 ウォーターサーバー',
    'ミネラルウォーター 宅配', 'ウォーターサーバー レンタル',
  ]},
];

const MAX_PAGES = 8;

/**
 * カテゴリごとの検証キーワード（収集時にショップが本当にその商品を扱うか確認）
 * 楽天 API の shopCode フィルタで確認するため HTML スクレイピング不要。
 */
const CATEGORY_VERIFY_QUERY = {
  '化粧品':       '化粧品',
  'サプリメント': 'サプリ',
  'ウォーターサーバー': 'ウォーターサーバー',
};

/** 検索結果HTMLから楽天ショップIDを抽出 */
function extractRakutenShopIds(html) {
  const ids = new Set();

  // item.rakuten.co.jp/{shop_id}/{item_id}/ 形式
  const re1 = /item\.rakuten\.co\.jp\/([a-zA-Z0-9_-]+)\//g;
  let m;
  while ((m = re1.exec(html)) !== null) {
    ids.add(m[1]);
  }

  // www.rakuten.co.jp/{shop_id}/ 形式（ショップTOPリンク）
  const re2 = /www\.rakuten\.co\.jp\/([a-zA-Z0-9_-]+)\//g;
  while ((m = re2.exec(html)) !== null) {
    const id = m[1];
    // 楽天の汎用パス（category, search等）を除外
    if (!['category', 'search', 'gold', 'event', 'ranking', 'books', 'travel'].includes(id)) {
      ids.add(id);
    }
  }

  return [...ids];
}

/** 楽天店舗固有の問い合わせURLを抽出 */
function extractRakutenInquiryUrl(html) {
  // inquiry.my.rakuten.co.jp/shop/{番号} 形式
  const m = html.match(/inquiry\.my\.rakuten\.co\.jp\/shop\/(\d+)/i);
  if (m) return `https://inquiry.my.rakuten.co.jp/shop/${m[1]}`;
  return '';
}

/** ショップIDからショップ情報を取得（表示名は会社概要 info.html を優先。charset=euc-jp に対応） */
async function fetchShopInfo(shopId) {
  const shopUrl = `https://www.rakuten.co.jp/${shopId}/`;
  const infoUrl = `https://www.rakuten.co.jp/${shopId}/info.html`;

  try {
    let infoHtml = '';
    try {
      infoHtml = await fetchRakutenHtml(infoUrl);
    } catch {
      /* info 取得失敗時はトップのみ */
    }

    const html = await fetchRakutenHtml(shopUrl);

    let shopName = infoHtml ? extractRakutenStoreNameFromInfoHtml(infoHtml) : '';
    if (!shopName) {
      shopName = parseRakutenShopTopTitle(html);
    }
    if (!shopName) shopName = shopId;

    let contact = extractRakutenInquiryUrl(html);
    const BAD_DOMAINS = ['rakuten', 'example', 'sentry', 'noreply', 'no-reply'];
    if (!contact) {
      const emails = html.match(/[\w.+%-]{2,50}@[\w.-]+\.[a-zA-Z]{2,}/g) || [];
      const validEmail = emails.find((e) => !BAD_DOMAINS.some((d) => e.includes(d)));
      if (validEmail) contact = validEmail;
    }

    if (!contact) {
      if (!infoHtml) {
        try {
          infoHtml = await fetchRakutenHtml(infoUrl);
        } catch {
          /* noop */
        }
      }
      if (infoHtml) {
        contact = extractRakutenInquiryUrl(infoHtml);
        if (!contact) {
          const emails = infoHtml.match(/[\w.+%-]{2,50}@[\w.-]+\.[a-zA-Z]{2,}/g) || [];
          contact = emails.find((e) => !BAD_DOMAINS.some((d) => e.includes(d))) || '';
        }
      }
    }

    return { shopName, shopUrl, contact };
  } catch {
    return null;
  }
}

export async function scrapeRakuten() {
  const { log, logPath } = maybeCreateCollectFileLogger('rakuten-collect', 'RAKUTEN_COLLECT_LOG_FILE');
  if (logPath != null) log(`ログファイル: ${logPath}`);

  const useApi = isRakutenWebServiceConfigured();
  log(
    `\n🛒 楽天市場 収集開始（店舗列挙: ${useApi ? '楽天ウェブサービス API' : '検索HTML（レガシー）'}）`
  );
  const existingKeys = await getExistingUrlCategoryKeys(SHEET_NAME);
  const seenPair = new Set();
  const rows = [];

  for (const { category, queries } of SEARCHES) {
    for (const query of queries) {
      log(`  [${category}] "${query}" を検索中...`);

      for (let page = 1; page <= MAX_PAGES; page++) {
        let ids = [];

        if (useApi) {
          const r = await fetchShopCodesFromItemSearch({ keyword: query, page, hits: 30 });
          if (r.error) {
            log(`    ⚠️  API: ${r.error}（p=${page}）`);
            break;
          }
          if (r.rawCount === 0) break;
          ids = r.shopCodes;
          if (ids.length === 0) break;
          await delay(250 + Math.random() * 200);
        } else {
          const url = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(query)}/?p=${page}`;

          let html;
          try {
            html = await fetchHtml(url);
          } catch (err) {
            log(`    ⚠️  ページ取得失敗 (p=${page}): ${err.message}`);
            break;
          }

          ids = extractRakutenShopIds(html);
          if (ids.length === 0) break;
        }

        for (const id of ids) {
          const pairKey = `${id}|${category}`;
          if (seenPair.has(pairKey)) continue;
          seenPair.add(pairKey);

          const shopUrl = `https://www.rakuten.co.jp/${id}/`;
          if (existingKeys.has(urlCategoryDuplicateKey(shopUrl, category))) continue;

          await delay(700 + Math.random() * 700);

          const info = await fetchShopInfo(id);
          if (!info || !info.contact) {
            if (info) log(`    ⚠️  ${info.shopName}: 問い合わせ先なし (保留)`);
            continue;
          }

          // API で対象カテゴリ商品の有無を確認（再発防止）
          const verifyQuery = CATEGORY_VERIFY_QUERY[category];
          if (verifyQuery && useApi) {
            const { count, error } = await fetchShopItemCountForVerify({ shopCode: id, keyword: verifyQuery });
            if (error) {
              log(`    ⚠️  検証API失敗 (${id}): ${error} → 保守的に追加`);
            } else if (count === 0) {
              log(`    ⊘ スキップ（API検証 0件）: ${info.shopName}`);
              continue;
            }
            await delay(250 + Math.random() * 150); // API レート制限対策
          }

          const displayName = shopDisplayNameForMarketplaceCategory(info.shopName, category);
          rows.push([category, displayName, info.shopUrl, info.contact, '', query]);
          log(`    ✓ [${category}] ${displayName} (${info.contact})`);
        }

        await delay(1500 + Math.random() * 1000);
      }
    }
  }

  await appendRows(SHEET_NAME, rows);
  writeLatestSummary({
    title: '楽天収集サマリー',
    overview: [
      { label: '対象シート', value: SHEET_NAME },
      { label: 'ログファイル', value: logPath ?? 'stdoutのみ' },
      { label: '店舗列挙方式', value: useApi ? '楽天ウェブサービス API' : '検索HTML（レガシー）' },
    ],
    metrics: [
      { label: '既存 URL×カテゴリ', value: `${existingKeys.size}件` },
      { label: '追記行数', value: `${rows.length}件` },
      { label: '最大ページ数', value: MAX_PAGES },
    ],
    sections: [
      {
        heading: '収集メモ',
        lines: [
          '- 問い合わせ先が取れた店舗のみ追記',
          '- 重複判定は C列URL + A列カテゴリ',
          '- API利用時はカテゴリ検証も実施',
        ],
      },
    ],
  });
  log(`\n完了: ${rows.length} 件`);
  return rows.length;
}

// 単体実行
if (process.argv[1].endsWith('scrape-rakuten.mjs')) {
  scrapeRakuten().catch(console.error);
}
