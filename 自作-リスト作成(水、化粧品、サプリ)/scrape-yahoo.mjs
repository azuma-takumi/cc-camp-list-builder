/**
 * Yahoo!ショッピング 店舗収集
 *
 * 検索結果から store.shopping.yahoo.co.jp/{store_id}/ のURLを抽出し、
 * 各ショップの info/ ページからメアド / お問い合わせURLを取得する。
 * D列: 常に Yahoo 共通の問い合わせフォーム（https://talk.shopping.yahoo.co.jp/contact/{store_id}）
 * E列: 取得できたメールアドレスのみ（任意）
 * F列: その店を初めて拾った検索クエリ（収集時のみ記録。過去行は空のまま）
 *
 * 同一店でもカテゴリごとに別行。B 列は会社概要のストア名（A 列でカテゴリが分かるため末尾に「サプリ」等は付けない）。
 * 店トップの title が英字スラッグのときは info.html から正式ストア名を補完する。
 * 重複判定は C列URL＋A列カテゴリ。
 *
 * --phase1-only : 検索でシート未登録のストアだけ列挙（連絡先取得・追記なし。TV のフェーズ1相当）
 * --max-rows=N / 環境変数 YAHOO_MAX_ROWS : シートへ追記する行の上限（お試し用）
 * --no-collect-log-file : 収集ログのファイル出力をしない（既定は ./logs/yahoo-collect-日時.log に追記）
 * 環境変数 YAHOO_COLLECT_LOG_FILE=0|false でもファイルログをオフにできる
 */

import {
  fetchHtml,
  fetchContactInfo,
  delay,
  shopDisplayNameForYahoo,
  urlCategoryDuplicateKey,
  yahooContactEmailFromFetched,
  yahooTalkContactUrl,
  fetchYahooOfficialStoreNameFromInfoHtml,
  looksLikeYahooRomanSlugDisplayName,
} from './utils.mjs';
import { maybeCreateCollectFileLogger } from './collect-log.mjs';
import { appendRows, getExistingUrlCategoryKeys } from './sheets.mjs';
import { writeLatestSummary } from './summary-writer.mjs';

const SHEET_NAME = '3.Yahoo';

// キーワードは重複しつつも検索結果の店舗集合が広がるよう、言い回しと下位カテゴリを分散
const SEARCHES = [
  {
    category: '化粧品',
    queries: [
      '化粧品 スキンケア',
      '美容液 化粧水',
      'コスメ 通販',
      'スキンケア 通販',
      'メイク コスメ',
      '化粧水 乳液',
      'クレンジング 洗顔',
      '敏感肌 スキンケア',
      'オーガニック 化粧品',
      '日焼け止め フェイス',
    ],
  },
  {
    category: 'サプリメント',
    queries: [
      'サプリメント 通販',
      '健康食品 ビタミン',
      'プロテイン サプリ',
      'コラーゲン サプリ',
      'ヒアルロン酸 サプリ',
      '乳酸菌 サプリ',
      'プロバイオティクス',
      '青汁 粉末',
      'オメガ3 EPA',
      'マルチビタミン',
    ],
  },
  {
    category: 'ウォーターサーバー',
    queries: [
      'ウォーターサーバー 宅配水',
      'ウォーターサーバー 通販',
      'ウォーターサーバー レンタル',
      '宅配水 ミネラルウォーター',
      '天然水 定期配送',
    ],
  },
];

/** 1クエリあたりの最大ページ数（n=60 なので 8 で最大480件ぶんの検索枠） */
const MAX_PAGES = 8;
const ITEMS_PER_PAGE = 60;

const PREVIEW_LINES = 50;

/**
 * 企業・単一ショップではないもの — 追記しない
 * （ふるさと納税窓口、G-Call 食通の定番のようなまとめ・キュレーション枠など）
 */
function isExcludedNonMerchantYahooStore(shopName, storeId) {
  const n = String(shopName ?? '');
  const id = String(storeId ?? '').toLowerCase();
  if (/ふるさと納税/.test(n)) return true;
  if (/Yahoo!?\s*ふるさと/i.test(n) || /ヤフー.*ふるさと/.test(n)) return true;
  if (id.includes('furusato')) return true;
  if (/G-?Call/i.test(n) && /食通の定番|お取り寄せ/.test(n)) return true;
  if (id === 'gcall' || id === 'g-call' || id === 'g_call') return true;
  // ウォーターサーバー等の対象事業なし（地域店舗・百貨系など）
  if (/シティオ豊橋/.test(n)) return true;
  return false;
}

/**
 * カテゴリキーワードごとのストア内検索クエリ
 * scrape 時にストア内検索（search.html?p=）でヒットするか確認するために使用
 */
const CATEGORY_VERIFY_QUERY = {
  '化粧品':     '化粧品',
  'サプリメント': 'サプリ',
  'ウォーターサーバー': 'ウォーターサーバー',
};

/**
 * ストア内検索で対象カテゴリの商品がヒットするか確認
 * @returns {boolean} true=ヒットあり / false=0件またはエラー（スキップ推奨）
 */
async function verifyStoreHasCategory(storeId, category) {
  const query = CATEGORY_VERIFY_QUERY[category];
  if (!query) return true; // 未設定カテゴリは検証をスキップ
  const url = `https://store.shopping.yahoo.co.jp/${storeId}/search.html?p=${encodeURIComponent(query)}`;
  try {
    const html = await fetchHtml(url);
    return !/見つかりません/.test(html);
  } catch {
    // 取得失敗（489等）の場合は判定不能 → 保守的にスキップしない
    return true;
  }
}

function getScrapeYahooMaxRows() {
  for (const a of process.argv) {
    if (a.startsWith('--max-rows=')) {
      const n = Number(a.slice('--max-rows='.length));
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
  }
  const e = process.env.YAHOO_MAX_ROWS;
  if (e) {
    const n = Number(e);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return Infinity;
}

/** 検索結果HTML から Yahoo Shopping の store ID を抽出 */
function extractYahooStoreIds(html) {
  const ids = new Set();
  const re = /store\.shopping\.yahoo\.co\.jp\/([a-zA-Z0-9_-]+)\//g;
  let m;
  while ((m = re.exec(html)) !== null) {
    ids.add(m[1]);
  }
  return [...ids];
}

/** ファンケル公式 Yahoo 店など、ページ title が長文のときは短い表示名にする */
function shortenYahooShopTitleFromPage(shopName) {
  const s = String(shopName ?? '').trim();
  if (/FANCL公式ショップ\s*Yahoo店/i.test(s)) {
    return 'FANCL公式ショップ Yahoo店';
  }
  return s;
}

/** store_id からショップ情報を取得 */
async function fetchStoreInfo(storeId) {
  const storeUrl = `https://store.shopping.yahoo.co.jp/${storeId}/`;

  try {
    const html = await fetchHtml(storeUrl);

    // ショップ名: <title>XXX - Yahoo!ショッピング</title>
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    let shopName = titleMatch
      ? titleMatch[1].replace(/\s*[-|ー]\s*(Yahoo!?ショッピング|ヤフーショッピング).*/i, '').trim()
      : storeId;
    shopName = shortenYahooShopTitleFromPage(shopName);

    if (looksLikeYahooRomanSlugDisplayName(shopName, storeId)) {
      const official = await fetchYahooOfficialStoreNameFromInfoHtml(storeId);
      if (official) shopName = official;
    }

    // メアド or お問い合わせURL（talk.shopping.yahoo.co.jp の問い合わせリンクも有効）
    const contact = await fetchContactInfo(storeUrl);

    return { shopName, storeUrl, contact };
  } catch {
    return null;
  }
}

/**
 * Yahoo 【フェーズ1のみ】検索でシートに無い store を列挙（各店の HTML / 連絡先は取得しない）
 */
export async function scrapeYahooPhase1Only() {
  const { log, logPath } = maybeCreateCollectFileLogger('yahoo-collect');
  if (logPath != null) log(`ログファイル: ${logPath}`);

  log('\n📦 Yahoo!ショッピング 【フェーズ1のみ】ストア候補の列挙（連絡先取得・シート追記なし）');
  const existingKeys = await getExistingUrlCategoryKeys(SHEET_NAME);
  log(`  シート既存 URL×カテゴリ: ${existingKeys.size} 件（A+C列）`);

  /** 同一ストアIDのカテゴリ別（同一ラン内の重複検索は除外） */
  const seenPair = new Set();
  /** @type {{ category: string, storeId: string, storeUrl: string }[]} */
  const candidates = [];

  for (const { category, queries } of SEARCHES) {
    for (const query of queries) {
      log(`  [${category}] "${query}" を検索中...`);

      for (let page = 1; page <= MAX_PAGES; page++) {
        const b = (page - 1) * ITEMS_PER_PAGE + 1;
        const url = `https://shopping.yahoo.co.jp/search?p=${encodeURIComponent(query)}&tab_ex=commerce&n=${ITEMS_PER_PAGE}&b=${b}`;

        let html;
        try {
          html = await fetchHtml(url);
        } catch (err) {
          log(`    ⚠️  ページ取得失敗 (p=${page}): ${err.message}`);
          break;
        }

        const ids = extractYahooStoreIds(html);
        if (ids.length === 0) break;

        let newThisPage = 0;
        for (const id of ids) {
          const pairKey = `${id}|${category}`;
          if (seenPair.has(pairKey)) continue;
          seenPair.add(pairKey);
          const storeUrl = `https://store.shopping.yahoo.co.jp/${id}/`;
          if (existingKeys.has(urlCategoryDuplicateKey(storeUrl, category))) continue;
          candidates.push({ category, storeId: id, storeUrl });
          newThisPage++;
        }
        if (newThisPage > 0) {
          log(`    → 新規候補 +${newThisPage}（累計 ${candidates.length}）`);
        }

        await delay(1200 + Math.random() * 800);
      }
    }
  }

  log(`\n  ── 候補合計（シート未掲載の store URL×カテゴリ）: ${candidates.length} 件 ──`);
  candidates.slice(0, PREVIEW_LINES).forEach((c, i) => {
    log(`    ${String(i + 1).padStart(3, ' ')}. [${c.category}] ${c.storeUrl}`);
  });
  if (candidates.length > PREVIEW_LINES) {
    log(`    … 他 ${candidates.length - PREVIEW_LINES} 件`);
  }

  writeLatestSummary({
    title: 'Yahoo収集サマリー',
    overview: [
      { label: '実行モード', value: 'phase1-only' },
      { label: '対象シート', value: SHEET_NAME },
      { label: 'ログファイル', value: logPath ?? 'stdoutのみ' },
    ],
    metrics: [
      { label: '既存 URL×カテゴリ', value: `${existingKeys.size}件` },
      { label: '新規候補数', value: `${candidates.length}件` },
      { label: 'プレビュー件数', value: `${Math.min(candidates.length, PREVIEW_LINES)}件` },
    ],
    sections: [
      {
        heading: 'プレビュー',
        lines: candidates.slice(0, PREVIEW_LINES).map((c, i) => `- ${i + 1}. [${c.category}] ${c.storeUrl}`),
      },
      {
        heading: '次の実行',
        lines: ['- npm run collect:yahoo'],
      },
    ],
  });

  log('\n  フェーズ2: npm run collect:yahoo（連絡先取得、未取得時は talk フォームURL → 3.Yahoo へ追記）');
  log(`\n完了: 候補 ${candidates.length} 件（フェーズ1のみ・追記なし）`);
  return candidates.length;
}

/** フェーズ2相当: 連絡先付きでシートへ追記 */
export async function scrapeYahoo() {
  const { log, logPath } = maybeCreateCollectFileLogger('yahoo-collect');
  if (logPath != null) log(`ログファイル: ${logPath}`);

  log('\n📦 Yahoo!ショッピング 収集開始');
  const maxRows = getScrapeYahooMaxRows();
  if (maxRows !== Infinity) {
    log(`  追記上限: ${maxRows} 件（--max-rows / YAHOO_MAX_ROWS）`);
  }
  const existingKeys = await getExistingUrlCategoryKeys(SHEET_NAME);
  const seenPair = new Set();
  const rows = [];

  yahooScrape: for (const { category, queries } of SEARCHES) {
    for (const query of queries) {
      log(`  [${category}] "${query}" を検索中...`);

      for (let page = 1; page <= MAX_PAGES; page++) {
        const b = (page - 1) * ITEMS_PER_PAGE + 1;
        const url = `https://shopping.yahoo.co.jp/search?p=${encodeURIComponent(query)}&tab_ex=commerce&n=${ITEMS_PER_PAGE}&b=${b}`;

        let html;
        try {
          html = await fetchHtml(url);
        } catch (err) {
          log(`    ⚠️  ページ取得失敗 (p=${page}): ${err.message}`);
          break;
        }

        const ids = extractYahooStoreIds(html);
        if (ids.length === 0) break; // 結果なし → 次クエリへ

        for (const id of ids) {
          const pairKey = `${id}|${category}`;
          if (seenPair.has(pairKey)) continue;
          seenPair.add(pairKey);

          const storeUrl = `https://store.shopping.yahoo.co.jp/${id}/`;
          if (existingKeys.has(urlCategoryDuplicateKey(storeUrl, category))) continue;

          await delay(600 + Math.random() * 600);

          const info = await fetchStoreInfo(id);
          const talkUrl = yahooTalkContactUrl(id);

          const label = info?.shopName ?? id;
          if (isExcludedNonMerchantYahooStore(info?.shopName ?? '', id)) {
            log(`    ⊘ スキップ（非企業・店舗）: ${label}`);
            continue;
          }

          // ストア内検索で対象カテゴリ商品がヒットするか確認（再発防止）
          const hasCategory = await verifyStoreHasCategory(id, category);
          if (!hasCategory) {
            log(`    ⊘ スキップ（ストア内検索 0件）: ${label}`);
            continue;
          }

          const displayName = info
            ? shopDisplayNameForYahoo(info.shopName, category)
            : shopDisplayNameForYahoo(id, category);

          const email = info ? yahooContactEmailFromFetched(info.contact) : '';

          let cUrlForRow = storeUrl;
          if (info?.contact) {
            cUrlForRow = info.storeUrl;
            rows.push([category, displayName, info.storeUrl, talkUrl, email, query]);
            log(`    ✓ [${category}] ${displayName}${email ? `  E:${email}` : ''}`);
          } else if (info) {
            cUrlForRow = info.storeUrl;
            rows.push([category, displayName, info.storeUrl, talkUrl, '', query]);
            log(`    ✓ [${category}] ${displayName} ※問い合わせ先未取得`);
          } else {
            rows.push([category, displayName, storeUrl, talkUrl, '', query]);
            log(`    ✓ [${category}] ${displayName} ※店名未取得`);
          }
          existingKeys.add(urlCategoryDuplicateKey(cUrlForRow, category));

          if (rows.length >= maxRows) {
            log(`\n  追記上限 ${maxRows} 件に達したため終了します`);
            break yahooScrape;
          }
        }

        await delay(1200 + Math.random() * 800);
      }
    }
  }

  const finalRows = [];
  const seenAppend = new Set();
  for (const row of rows) {
    const k = urlCategoryDuplicateKey(row[2], row[0]);
    if (seenAppend.has(k)) continue;
    seenAppend.add(k);
    finalRows.push(row);
  }
  if (finalRows.length !== rows.length) {
    log(`  ⚠ 追記直前に ${rows.length - finalRows.length} 件の重複キーを除外しました`);
  }

  await appendRows(SHEET_NAME, finalRows);
  writeLatestSummary({
    title: 'Yahoo収集サマリー',
    overview: [
      { label: '実行モード', value: 'collect' },
      { label: '対象シート', value: SHEET_NAME },
      { label: 'ログファイル', value: logPath ?? 'stdoutのみ' },
      { label: '追記上限', value: maxRows === Infinity ? '制限なし' : `${maxRows}件` },
    ],
    metrics: [
      { label: '収集行数', value: `${rows.length}件` },
      { label: '追記行数', value: `${finalRows.length}件` },
      { label: '重複除外件数', value: `${rows.length - finalRows.length}件` },
    ],
    sections: [
      {
        heading: '収集メモ',
        lines: [
          '- 問い合わせURLは Yahoo 共通フォームに正規化',
          '- 重複判定は C列URL + A列カテゴリ',
        ],
      },
    ],
  });
  log(`\n完了: ${finalRows.length} 件追記`);
  return finalRows.length;
}

// 単体実行: node scrape-yahoo.mjs [--phase1-only]
if (process.argv[1].endsWith('scrape-yahoo.mjs')) {
  const phase1 = process.argv.includes('--phase1-only');
  const run = phase1 ? scrapeYahooPhase1Only : scrapeYahoo;
  run().catch(console.error);
}
