/**
 * TVショッピング・自社通販 店舗収集
 *
 * TVショッピングチャンネルサイトから出品ブランド/会社を収集し、
 * 各社の問い合わせ情報を取得する。
 * （QVC: ビューティ N-3 ＋ ヘルス N-4。SC: コスメ・美容健康＋サプリ棚・健康食品＋ドリンク棚＝ウォーター／宅配水ブランド名のみ）
 *
 * 対象チャンネル:
 *   - QVC Japan (qvc.jp)
 *   - ショップチャンネル (shopchannel.co.jp)
 *   - ジャパネット (japanet.co.jp)
 *   - ショップジャパン (shopjapan.co.jp)
 *   - テレショップ / NHKエンタープライズ 等
 *
 * ＋ 自社通販（Google 検索ベースで主要メーカー直販サイト）
 */

import { fetchHtml, fetchContactInfo, delay, log, normalizeBrandNameKey } from './utils.mjs';
import { appendRows, getExistingUrls, getExistingNames } from './sheets.mjs';
import { writeLatestSummary } from './summary-writer.mjs';

const TV_SHEET   = '1.TVショッピング';
const OWN_SHEET  = '2.自社通販';

/** フェーズ2で処理しないブランド（--skip-brand=名 複数はカンマ / TV_SKIP_PHASE2 環境変数） */
function getPhase2SkipBrandKeys() {
  const keys = new Set();
  for (const a of process.argv) {
    if (a.startsWith('--skip-brand=')) {
      const raw = a.slice('--skip-brand='.length);
      for (const part of raw.split(',')) {
        const k = normalizeBrandNameKey(part);
        if (k) keys.add(k);
      }
    }
  }
  const env = process.env.TV_SKIP_PHASE2;
  if (env) {
    for (const part of env.split(',')) {
      const k = normalizeBrandNameKey(part);
      if (k) keys.add(k);
    }
  }
  return keys;
}

// ── ショップチャンネル (www.shopch.jp) ────────────────────────────────
const SC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// コスメ(04)・美容(05) ＋ 健康配下のサプリ／健康食品／ドリンク棚（水サーバー関連ブランドに限定して採用）
// aisleCategory: 製品が該当棚から来た場合の A 列デフォルト（名前推定より先）
// waterServerNameFilter: ドリンク／お茶カテゴリから来た製品で、ブランド名がウォーターサーバー候補に合致するものだけ候補化（お茶・コーヒー等は落とす）
const SC_CATEGORY_URLS = [
  { label: 'コスメ',  url: 'https://www.shopch.jp/pc/product/prodlist/category?category1=04', aisleCategory: null, waterServerNameFilter: false },
  { label: '美容健康', url: 'https://www.shopch.jp/pc/product/prodlist/category?category1=05', aisleCategory: null, waterServerNameFilter: false },
  { label: 'ドリンク棚(水サーバー候補のみ)', url: 'https://www.shopch.jp/pc/product/prodlist/category?category1=05&category2=030&category3=170', aisleCategory: null, waterServerNameFilter: true },
  { label: 'サプリメント', url: 'https://www.shopch.jp/pc/product/prodlist/category?category1=05&category2=030&category3=075', aisleCategory: 'サプリメント', waterServerNameFilter: false },
  { label: '健康サポート食品', url: 'https://www.shopch.jp/pc/product/prodlist/category?category1=05&category2=030&category3=058', aisleCategory: 'サプリメント', waterServerNameFilter: false },
];

/**
 * ウォーターサーバー／宅配飲料水ブランドとみなす名前か（お茶・コーヒー中心のブランドは除外。件数は少なくてよい）
 */
function matchesWaterServerBrandName(brandName) {
  const s = String(brandName ?? '');
  if (/お茶|煎茶|玉露|抹茶|緑茶|紅茶|烏龍|ウーロン|麦茶|焙じ茶|ほうじ茶|コーヒー|珈琲|ドリップ|エスプレッソ|ジュース|サイダー|ラテ|炭酸|ソーダ|スムージー/i.test(s)) {
    return false;
  }
  if (/ウォーター|水サーバー|宅配水|天然水|ミネラルウォーター|ウォーターサーバー|天領水|ボトルウォータ|純水(\s|・|$)/i.test(s)) {
    return true;
  }
  if (/クリクラ|コスモウォータ|アクアクララ|プレミアムウォータ|フレシャス|ナチュラルウォータ|ワンウェイウォータ|ウォーターダイレクト|ベルクレール|アルピナウォータ|ハワイアンウォータ|日田天領|サントリーウォータ|いろはす|南アルプス|富士の湧水|秩父源流水/i.test(s)) {
    return true;
  }
  if (/宅配/.test(s) && /水|ウォーター/.test(s)) return true;
  return false;
}

/** ブランド名から サプリ / ウォーター。化粧品は判定しない（単独の「水」「サーバー」は誤爆のため使わない） */
function inferSupplementOrWaterCategory(brandName) {
  const s = String(brandName ?? '');
  if (matchesWaterServerBrandName(brandName)) {
    return 'ウォーターサーバー';
  }
  if (/サプリ|サプリメント|健康食品|機能性表示|乳酸菌|プロバイオ|整腸|善玉菌|発酵|プラセンタ|アミノ酸|酵母|酵素|ビタミン|青汁|dha|epa|オメガ|コラーゲン|プロテイン|カルシウム|鉄分|マルチビタミン|ヒアルロン|プロポリス|ハチミツ|蜂蜜|茸|カプセル|粒タイプ/i.test(s)) {
    return 'サプリメント';
  }
  if (/亜麻|アマニ|オメガ3|nmn|nad|コエンザイム|フィッシュオイル/i.test(s)) {
    return 'サプリメント';
  }
  return null;
}

// ショップチャンネル 明らかに無関係なブランドを除外
const SC_SKIP_BRANDS = new Set([
  'KAZUE ウィッグ', 'アイブレラ(サングラス)', '3Dアーチインソール',
  '整体師が本気で考えたシリーズ', 'ラックラック 空飛ぶシリーズ', 'ラックラックアクティブウェア',
  'Newmeeローリングクッション', 'Newmee サポートインナー', 'ノーブル(サポーター)',
  'ルネサンス', 'エプロ', 'カーブルチェア', 'アーチフィッター',
  '発酵干し芋', 'メロディアン', 'アサヒ メディカルウォーク',
  'Prince135', '奇跡の歯ブラシ・ホワイトクリーナー・舌ブラシ',
  'こつみつデンタル', 'ポリリンジェル・リンス(口臭・口腔ケア)',
  // 検索NG（全く違うサイトが返る小規模ブランド）
  '熟酵',  // jukkou.com = 翻訳エンジン会社
  'アールバトン', '2050', 'G.H.S(ジーエイチエス)', 'シラガレスキュー',
  'UVフィニッシングパウダー', 'エクスプレスパウダー・パウダースノーVC',
  'マスリンエイド', 'ブラックバーン&モイスト', 'アカデミア酵母',
  'プレミアムベリー', '大人リッチ', 'グローブインボトル',
  'ファイスリー', // アパレル（f-ice.jp）コスメ対象外
  'アップルミントシュガー', // 化粧品関連ではない
  'メヘンディ', // 問い合わせフォームが見つからず対象外
  'gd11', 'GD11', // 問い合わせフォームが見つからず対象外
  'ヴィオーデ', '芦屋美整体', // 整体サロン（化粧品メーカーではない）
  'リリーグレイス', // ネイル中心でスキンケア主眼のリストから除外
  '花蔵', // 和食店
  'ウィッグ(ファッションウィッグ&ケア用品)', // ウィッグ専門店
  'ウィッグ(ファッションウィッグ＆ケア用品)', // 全角&表記の揺れ
  'キリン イミューズ', 'キリンイミューズ', // シートのリンク先が利用不可のため除外
  'ドクターアミノ パワーグリーン', 'ドクターアミノ',
  'BEAXIS', // スポーツギア中心（化粧品対象外）
  'あゆみ', // 靴・シューズ関連（化粧品対象外）
  'ラブクロム', 'リジュラン',
  'ラヴィアンズ', 'ラヴィアンス', // ケーキ店などコスメ対象外（シート表記の揺れ）
  'ウィリアム・モリスステッキ', // 雑誌・記事メディア起点でブランド企業ではない
  'ビューティーセカンズ', 'ビューティセカンズ', // 問い合わせフォームなし（表記の揺れ）
  'スプリングウォーク', // タイツ・アパレル（営業リスト対象外）
  'B-glen', 'B-Glen', 'b-glen', 'ビーグレン', // 旧公式ドメインが転売・利用不可のため除外
  '一ノ蔵コスメ', // 酒蔵が本業・コスメは副次のため営業リスト対象外
  'ゾーンラボ', // zonelabs.jp 等が開けず公式不可のため除外
  'ハタケヤマ', // 野球用品は本リスト対象外／旧サプリ表記も「ハタケヤマ」で混線するため SC では一律除外
  'ウォーターダイレクト', // プレミアムウォーター社と同一・リストはプレミアムウォーターのみ
  'ベルクレール', // 2025年破産手続き開始・公式サイト利用不可のため営業対象外
  'ドクターズコスメ', // 旧 drcos.com はドメイン転売等で公式不可のため除外
]);

// ショップチャンネル 既知ブランドURL（検索不要）
const SC_KNOWN_BRANDS = {
  'ザ フェイスショップ':      { category: '化粧品',       url: 'https://www.thefaceshop.com/jp/',        contact: 'https://www.thefaceshop.com/jp/help/contact.html' },
  '太田胃散 おいしい桑の葉青汁': { category: 'サプリメント', url: 'https://www.ohta-isan.co.jp/',          contact: 'https://www.ohta-isan.co.jp/faq/product/' },
  'ニップン アマニ油&DHA':    { category: 'サプリメント', url: 'https://www.nippn.co.jp/',                contact: '' },
  '森下仁丹 サラシア':        { category: 'サプリメント', url: 'https://www.jintan.co.jp/',               contact: 'https://www.jintan.co.jp/contact/' },
  '森下仁丹食養生シリーズ':   { category: 'サプリメント', url: 'https://www.jintan.co.jp/',               contact: 'https://www.jintan.co.jp/contact/' },
  'ビー サクセス':            { category: '化粧品',       url: 'https://andbe-official.com/',             contact: 'https://andbe-official.com/shop/customer' },
  // SC表記「ビタクリーム B12」→ 企業名はビタブリッドジャパン
  'ビタクリーム B12':         { category: '化粧品',       sheetName: 'ビタブリッドジャパン', url: 'https://vitabrid.co.jp/', contact: 'https://corporate.vitabrid.co.jp/contact/contact-top.html' },
  'パルマディーバ':           { category: '化粧品',       url: 'https://www.palma.jp/',                   contact: 'https://www.palma.jp/contact/' },
  // ショップチャンネル表記「プラセンタワン」→ 企業名は協和薬品
  'プラセンタワン':           { category: 'サプリメント', sheetName: '協和薬品', url: 'https://kyowa-yakuhin.co.jp/', contact: 'https://kyowa-yakuhin.co.jp/contact/' },
  'フロムザスキン':           { category: '化粧品',       url: 'https://www.fromtheskin.jp/',             contact: 'https://www.fromtheskin.jp/contact-8' },
  // SC表記と企業名・問い合わせの対応
  'ストレーニア':             { category: '化粧品',       sheetName: 'アメプラ', url: 'https://www.amepla.jp/', contact: 'https://www.amepla.jp/f/contact' },
  'サントノレ29':            { category: '化粧品',       sheetName: 'メディカライズヘルスケア', url: 'https://medicaraise-healthcare.jp/', contact: 'https://medicaraise-healthcare.jp/contact/' },
  'ソーダスパフォーム':       { category: '化粧品',       sheetName: '東洋炭酸研究所', url: 'https://www.tansanmagic-jp.com/', contact: 'https://www.tansanmagic-jp.com/contact/' },
  'イオングロウブラシ':       { category: '化粧品',       sheetName: 'chouchou', url: 'https://chouchou-tokyo.com/', contact: 'https://chouchou-tokyo.com/pages/contact' },
  /** C: ショップチャンネル番組タブ／ブランドページ D: チャンネル公式お問い合わせ入口 */
  'ビジュードゥメール':       { category: '化粧品',       url: 'https://www.shopch.jp/pc/tv/programlist/brand?brandCode=11001&searchType=3&latestPgmPage=1&latestPgmStartDaytime=20260422151000&il=Search_HeaderLink&ic=programtab#noscroll', contact: 'https://www.shopch.jp/InquiryInit.do?il=Footer&ic=contact' },
  // SC表記「コラボーテ」→ 日本独占販売元は株式会社ビ・マジーク
  'コラボーテ':               { category: '化粧品',       sheetName: 'ビ・マジーク', url: 'https://www.vie-magique.com/', contact: 'https://shop.vie-magique.com/contact/index' },
  // SC表記「エオローラ」→ 販売元は株式会社ドゥ・ベスト（DO-BEST）
  'エオローラ':               { category: '化粧品',       sheetName: 'DO-BEST', url: 'https://www.dobest.co.jp/', contact: 'https://ec.dobest.tokyo/shop/contact/draft' },
  // 主力は健康・スポーツ関連（水溶性ミネラル等）。コスメもあるが本リストではサプリメント扱い
  'ファイテン':               { category: 'サプリメント', url: 'https://www.phiten.com/',              contact: 'https://www.phiten.com/contact/' },
};

// ショップチャンネルのカテゴリ一覧から製品番号を取得（page=1… を列挙して取り切る）
const SC_ITEMS_PER_PAGE = 48;

async function fetchScProductNos(categoryListUrl) {
  const headers = { 'User-Agent': SC_UA, 'Accept-Language': 'ja', 'Referer': 'https://www.shopch.jp/' };
  const ids = new Set();
  let totalPages = 1;

  try {
    for (let page = 1; page <= totalPages; page++) {
      const u = new URL(categoryListUrl);
      u.searchParams.set('searchType', '2');
      u.searchParams.set('page', String(page));

      const res = await fetch(u.toString(), { headers, signal: AbortSignal.timeout(20000) });
      if (!res.ok) break;
      const html = await res.text();

      if (page === 1) {
        let lastFromTotal = 1;
        const totalM = html.match(/全(\d+)商品/);
        if (totalM) {
          lastFromTotal = Math.max(1, Math.ceil(parseInt(totalM[1], 10) / SC_ITEMS_PER_PAGE));
        }
        const pagerNums = [...html.matchAll(/pageChange\((\d+)\)/g)].map((g) => parseInt(g[1], 10));
        const lastFromPager = pagerNums.length > 0 ? Math.max(...pagerNums) : 1;
        totalPages = Math.max(lastFromTotal, lastFromPager);
      }

      for (const m of html.matchAll(/reqprno=(\d{5,8})/gi)) {
        ids.add(m[1]);
      }

      if (page < totalPages) {
        await delay(350 + Math.random() * 200);
      }
    }
  } catch {
    /* ignore */
  }

  return [...ids];
}

// 製品番号 → ブランドコードを取得
async function fetchScBrandCode(prodNo) {
  try {
    const res = await fetch(`https://www.shopch.jp/pc/product/proddetail?reqprno=${prodNo}&fromProdList=true`, {
      headers: { 'User-Agent': SC_UA, 'Accept-Language': 'ja', 'Referer': 'https://www.shopch.jp/' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/prodlist\/brand\?brandCode=(\d+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

// ブランドコード → ブランド名（ブランドリストHTMLから）
let _scBrandMap = null;
async function getScBrandMap() {
  if (_scBrandMap) return _scBrandMap;
  try {
    const res = await fetch('https://www.shopch.jp/BrandList.do', {
      headers: { 'User-Agent': SC_UA, 'Accept-Language': 'ja', 'Referer': 'https://www.shopch.jp/' },
      signal: AbortSignal.timeout(15000),
    });
    const html = await res.text();
    _scBrandMap = new Map();
    const re = /<a href="\/pc\/product\/prodlist\/brand\?brandCode=(\d+)"[^>]*>([^<]+)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      if (!_scBrandMap.has(m[1])) _scBrandMap.set(m[1], m[2].trim());
    }
  } catch { _scBrandMap = new Map(); }
  return _scBrandMap;
}

/** ショップチャンネル: シートにない企業名の候補だけ列挙（URL解決は後段） */
async function discoverShopChannelCandidates(existingNames) {
  log('  [ショップチャンネル・発見] 候補ブランドを列挙...');
  const candidates = [];
  const seenCodes = new Set();

  const brandMap = await getScBrandMap();
  log(`    ブランドリスト: ${brandMap.size}件ロード`);

  const allProdNos = [];
  /** @type {Map<string, string>} 製品番号 → 棚から付与するカテゴリ（後から来た非nullで上書き） */
  const prodAisleCategory = new Map();
  /** @type {Set<string>} ドリンク棚（水以外お茶等を混ぜないフィルタ対象）由来の製品番号 */
  const prodFromDrinkAisleWaterFilter = new Set();
  for (const { label, url, aisleCategory, waterServerNameFilter } of SC_CATEGORY_URLS) {
    const nos = await fetchScProductNos(url);
    log(`    [SC/${label}] ${nos.length} 製品番号（カテゴリ全ページ）`);
    for (const n of nos) {
      if (aisleCategory) prodAisleCategory.set(n, aisleCategory);
      if (waterServerNameFilter) prodFromDrinkAisleWaterFilter.add(n);
      allProdNos.push(n);
    }
  }
  const uniqueProdNos = [...new Set(allProdNos)];
  log(`    全製品番号: ${uniqueProdNos.length}件（重複除外）`);

  for (const prodNo of uniqueProdNos) {
    await delay(400 + Math.random() * 300);
    const code = await fetchScBrandCode(prodNo);
    if (!code || seenCodes.has(code)) continue;
    seenCodes.add(code);

    const brandName = brandMap.get(code) || code;
    if (SC_SKIP_BRANDS.has(brandName)) continue;

    const key = normalizeBrandNameKey(brandName);
    if (existingNames.has(key)) continue;

    const known = SC_KNOWN_BRANDS[brandName];
    if (prodFromDrinkAisleWaterFilter.has(prodNo)) {
      if (known?.category !== 'ウォーターサーバー' && !matchesWaterServerBrandName(brandName)) {
        continue;
      }
    }

    const fromAisle = prodAisleCategory.get(prodNo);
    let category = known?.category;
    if (!category) {
      category = fromAisle || inferSupplementOrWaterCategory(brandName) || '化粧品';
    }

    candidates.push({ source: 'shopch', name: brandName, category, known });
  }

  log(`    → シート未掲載（名前基準）候補: ${candidates.length} 件`);
  return candidates;
}

// ── QVC Japan ブランド一覧ページ ──────────────────────────────────────
const QVC_BRAND_LIST_URLS = [
  { label: '化粧品・ビューティ', url: 'https://qvc.jp/content/brandsaz.N-3.html' },
  { label: 'ヘルス・生活', url: 'https://qvc.jp/content/brandsaz.N-4.html' },
];

// 化粧品・サプリ以外の明確に無関係なQVCブランドを除外
const QVC_SKIP_BRANDS = new Set([
  'ブラデリスニューヨーク', 'ウイング', 'ロダニア', 'キプリング', 'バイオニック',
  'スケッチャーズ', 'ドルチェ', 'ビューフォート', '遺伝子検査ジーンライフ',
  'Jinka Nezu', 'ピアリング', 'エアウィーヴ', 'キャシーマム', '京都西川',
  'Danfill(ダンフィル)', 'TEIJIN（帝人）', 'IWATANI（岩谷）', '保阪流',
  'トゥルースリーパー', 'THERMOS（サーモス）', 'CONDOR（コンドル）',
  'ミズノ（MIZUNO）', 'フィラ（FILA）', '万能だし千代の一番', 'JAグループ・全農食品',
  'ベジーマリア', 'トロピカルマリア', '吉野家の牛丼', 'リエコーヒー',
  'BALMUDA（バルミューダ）', '東芝', 'SHARK（シャーク）', 'siroca（シロカ）',
  'BRUNO（ブルーノ）', '象印', "De'Longhi（デロンギ）", 'パーソンズ', 'アンコキーヌ',
  'スーパーレディ', 'Ode',
  // 検索でURL検証NGだったブランド（QVC専売・niche）
  'エスパスデカルマ', 'アンドラブ', 'サイムダン （IKKO）',
  'エスプリーナ （アン ミカ）', 'イザノックス', 'ジェイアベックトワ',
  '大橋タカコ', 'エレクトーレ', 'マシロ', 'ギブリコレクション',
  'ピクシーハート', 'プロポリス', 'クロワール', '馬プラセンタモンローブロンド',
  'サプリ生活', 'リフレ', 'TarTar',   '麻布プロバドール',
  'B-glen', 'B-Glen', 'b-glen', 'ビーグレン',
  '一ノ蔵コスメ',
  'ゾーンラボ',
  'ハタケヤマ', // 野球用品はカテゴリ外（リスト方針）
  'ウォーターダイレクト', // プレミアムウォーター社と同一・リストはプレミアムウォーターのみ
  'ベルクレール', // 2025年破産手続き開始・公式サイト利用不可のため営業対象外
  'ドクターズコスメ', // 旧 drcos.com はドメイン転売等で公式不可のため除外
]);

// QVC化粧品・サプリブランドの既知公式URL（検索不要）
// category は化粧品/サプリメントを手動で分類
const QVC_KNOWN_BRANDS = {
  'ドクターシーラボ':     { category: '化粧品',       url: 'https://www.ci-labo.com/',         contact: 'https://www.ci-labo.com/contact/' },
  'ReFa':                 { category: '化粧品',       url: 'https://www.mtgec.jp/',            contact: 'https://www.mtg.gr.jp/feedback/' },
  'パピリオ':             { category: '化粧品',       url: 'https://www.papilio.co.jp/',       contact: 'https://www.papilio.co.jp/shop/customer/menu.aspx' },
  '伊藤園':               { category: 'サプリメント', url: 'https://www.itoen.co.jp/',         contact: 'https://www.itoen.co.jp/form/product/' },
  'コンビタマヌカハニー': { category: 'サプリメント', url: 'https://www.comvita.com/ja-jp/',   contact: 'https://www.comvita.com/ja-jp/' },
};

// ── 自社通販 既知主要ブランド一覧 ─────────────────────────────────────
// 大手 / TV出演実績のある化粧品・サプリ・ウォーターサーバーメーカーの直販URL
export const OWN_BRANDS = [
  // 化粧品 — contact: 既知の問い合わせURL（自動取得が困難なサイト向け）
  { category: '化粧品', name: 'ファンケル',         url: 'https://www.fancl.jp/',                   contact: 'https://www.fancl.co.jp/shopping/toiawase/index.html' },
  { category: '化粧品', name: 'ドクターシーラボ',   url: 'https://www.ci-labo.com/',                contact: 'https://www.ci-labo.com/contact/' },
  { category: '化粧品', name: 'DHC',                url: 'https://www.dhc.co.jp/',                  contact: 'https://www.dhc.co.jp/contact-mail-address/' },
  { category: '化粧品', name: 'オルビス',           url: 'https://www.orbis.co.jp/',                contact: 'https://www.orbis.co.jp/customer/' },
  { category: '化粧品', name: 'ナリス化粧品',       url: 'https://www.naris.co.jp/',                contact: 'https://www.naris.co.jp/contact/' },
  { category: '化粧品', name: 'アスタリフト',       url: 'https://www.astalift.jp/',                contact: 'https://www.astalift.jp/contact/' },
  // /support/contact/ は404。/contact/ → shop フォームへ
  { category: '化粧品', name: 'エトヴォス',         url: 'https://www.etvos.com/', contact: 'https://www.etvos.com/shop/contact/contact.aspx' },
  { category: '化粧品', name: 'ドモホルンリンクル', url: 'https://www.domohorn.com/',               contact: 'https://www.domohorn.com/inquiry/' },
  { category: '化粧品', name: 'エリクシール',       url: 'https://www.shiseido.co.jp/elixir/',      contact: 'https://www.shiseido.co.jp/elixir/club/qa.html' },
  { category: '化粧品', name: 'ハーバー研究所',     url: 'https://www.haba.co.jp/' },
  { category: '化粧品', name: 'ちふれ',             url: 'https://www.chifure.co.jp/',              contact: 'https://www.chifure.co.jp/inquiry' },
  { category: '化粧品', name: 'DECENCIA',           url: 'https://www.decencia.co.jp/',             contact: 'https://www.decencia.co.jp/contact/' },
  { category: '化粧品', name: 'スキンケアファクトリー', url: 'https://skincare-factory.com/',       contact: 'https://cart.skincare-factory.com/contact/index' },
  { category: '化粧品', name: '北の快適工房',       url: 'https://www.kaitekikobo.jp/',             contact: 'https://www.kaitekikobo.jp/' },
  // サプリメント
  { category: 'サプリメント', name: 'ファンケル サプリ', url: 'https://www.fancl.co.jp/healthy/index.html', contact: 'https://www.fancl.co.jp/shopping/toiawase/index.html' },
  { category: 'サプリメント', name: 'DHC サプリ',        url: 'https://www.dhc.co.jp/health/', contact: 'https://www.dhc.co.jp/contact-mail-address/' },
  { category: 'サプリメント', name: 'ネイチャーメイド',  url: 'https://www.otsuka.co.jp/nmd/', contact: 'https://www.otsuka.co.jp/contact/' },
  { category: 'サプリメント', name: 'ディアナチュラ',    url: 'https://www.dear-natura.com/', contact: 'https://www.asahi-gf.co.jp/web-service/asahi-gf/customer/form.wsp.html?CMD=onForm' },
  { category: 'サプリメント', name: 'GronG',             url: 'https://grong.jp/',                   contact: 'https://grong.jp/pages/contact' },
  { category: 'サプリメント', name: 'ビーレジェンド',    url: 'https://belegend.jp/',           contact: 'https://store.belegend.jp/apply.html?id=APPLY1' },
  { category: 'サプリメント', name: 'サントリーウェルネス', url: 'https://www.suntory-kenko.com/',  contact: 'https://www.suntory-kenko.com/inquiry/' },
  { category: 'サプリメント', name: '森下仁丹',          url: 'https://www.jintan.co.jp/',           contact: 'https://www.jintan.co.jp/contact/' },
  { category: 'サプリメント', name: 'ユーグレナ', url: 'https://www.euglena.jp/',                 contact: 'https://www.euglena.jp/contact/' },
  { category: 'サプリメント', name: '井藤漢方製薬',      url: 'https://www.itohkampo.co.jp/',        contact: 'https://www.itohkampo.co.jp/contact/form/' },
  // ウォーターサーバー
  // aquaclara.co.jp（非www）は証明書不一致のため www 公式のみ
  { category: 'ウォーターサーバー', name: 'プレミアムウォーター', url: 'https://premium-water.net/', contact: 'https://premium-water.net/tel/' },
  { category: 'ウォーターサーバー', name: 'アクアクララ',         url: 'https://www.aquaclara.co.jp/', contact: 'https://www.aquaclara.co.jp/contact/' },
  { category: 'ウォーターサーバー', name: 'コスモウォーター',     url: 'https://www.cosmowater.com/',     contact: 'https://www.cosmowater.com/support/' },
  { category: 'ウォーターサーバー', name: 'クリクラ',             url: 'https://www.crecla.jp/',          contact: 'https://www.crecla.jp/contact/' },
  // ウォーターダイレクトはプレミアムウォーター社と同一のため OWN_BRANDS ではプレミアムウォーターのみ掲載（TV候補は SC/QVC スキップ）
  { category: 'ウォーターサーバー', name: 'サントリーウォーター', url: 'https://www.suntory.co.jp/group/sbs/business/officewater/server/', contact: 'https://www.suntory.co.jp/group/sbs/contact/' },
  { category: 'ウォーターサーバー', name: 'フレシャス',           url: 'https://www.frecious.jp/',        contact: 'https://www.frecious.jp/contact/' },
  // 旧 naturalwater.co.jp は接続不可。運営は株式会社アルファライズ（natural-inc.com）
  { category: 'ウォーターサーバー', name: 'ナチュラルウォーター', url: 'https://natural-inc.com/', contact: 'https://natural-inc.com/contact/' },
  // 旧 www.oneway-water.jp は利用不可。現行公式は onewaywater.com
  { category: 'ウォーターサーバー', name: 'ワンウェイウォーター', url: 'https://onewaywater.com/', contact: 'https://onewaywater.com/ssl/new_contact' },
  // 化粧品 追加分
  { category: '化粧品', name: 'ポーラ',           url: 'https://www.pola.co.jp/',              contact: 'https://www.pola.co.jp/contact/' },
  { category: '化粧品', name: 'アテニア',         url: 'https://www.attenir.co.jp/',            contact: 'https://www.attenir.co.jp/help/situmon_sp.html' },
  { category: '化粧品', name: 'メナード',         url: 'https://www.menard.co.jp/',             contact: 'https://www.menard.co.jp/form/customer' },
  { category: '化粧品', name: 'アルビオン',       url: 'https://www.albion.co.jp/',             contact: 'https://www.albion.co.jp/site/p/albion_inquiry.aspx' },
  { category: '化粧品', name: 'ロート製薬',       url: 'https://www.rohto.co.jp/',              contact: 'https://jp.rohto.com/support/contact/' },
  { category: '化粧品', name: 'コーセー',         url: 'https://www.kose.co.jp/',               contact: 'https://www.kose.co.jp/jp/ja/contact/' },
  { category: '化粧品', name: 'イプサ',           url: 'https://www.ipsa.co.jp/',               contact: 'https://www.ipsa.co.jp/contact/' },
  { category: '化粧品', name: 'アクアレーベル',   url: 'https://www.shiseido.co.jp/aqua/', contact: 'https://corp.shiseido.com/jp/inquiry/' },
  { category: '化粧品', name: 'ルルルン',         url: 'https://lululun.com/',                   contact: 'https://lululun.com/contact/' },
  // www.curel.jp は同名の整体サロンサイト。化粧品キュレル（花王）は kao-kirei 公式
  { category: '化粧品', name: 'キュレル',         url: 'https://www.kao-kirei.com/ja/official/curel/', contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'セザンヌ化粧品',   url: 'https://www.cezanne.co.jp/',            contact: 'https://www.cezanne.co.jp/contact/' },
  // サプリメント 追加分
  { category: 'サプリメント', name: '山田養蜂場', url: 'https://www.3838.com/',                 contact: 'https://www.3838.com/contact/' },
  { category: 'サプリメント', name: '小林製薬',   url: 'https://www.kobayashi.co.jp/',          contact: 'https://www.kobayashi.co.jp/customer/' },
  { category: 'サプリメント', name: 'ロート製薬 サプリ', url: 'https://hadalabo.jp/supplement/', contact: 'https://jp.rohto.com/support/contact/' },
  { category: 'サプリメント', name: '大正製薬',   url: 'https://www.taisho.co.jp/',             contact: 'https://www.taisho.co.jp/contact/' },
  // 協和発酵バイオ: B2B原料メーカーのためリスト対象外
  { category: 'サプリメント', name: 'わかさ生活', url: 'https://www.wakasa.jp/',                contact: 'https://www.wakasa.jp/contact/' },
  { category: 'サプリメント', name: '太田胃散',   url: 'https://www.ohta-isan.co.jp/',          contact: 'https://www.ohta-isan.co.jp/faq/product/' },
  // 旧 /contact/ は404。製品・セルフケアの窓口
  { category: 'サプリメント', name: 'エーザイ',   url: 'https://www.eisai.co.jp/',              contact: 'https://www.eisai.co.jp/inquiry/product/index.html' },
  // ── 追加バッチ3（20ブランド） ───────────────────────────────────────
  // 化粧品
  // 旧 /contact/ ・ consumer 窓口は404等のため現行パスへ
  { category: '化粧品', name: '資生堂',         url: 'https://www.shiseido.co.jp/',           contact: 'https://corp.shiseido.com/jp/inquiry/mail/' },
  { category: '化粧品', name: '花王',           url: 'https://www.kao.com/jp/',               contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'カネボウ化粧品', url: 'https://www.kanebo-cosmetics.jp/',       contact: '' },
  { category: '化粧品', name: 'アユーラ',       url: 'https://www.ayura.co.jp/',              contact: '' },
  // 旧 nov.co.jp は利用不可。公式オンラインショップは noevirgroup.jp/nov/
  { category: '化粧品', name: 'ノブ',           url: 'https://noevirgroup.jp/nov/',           contact: 'https://noevirgroup.jp/nov/pages/contact.aspx' },
  { category: '化粧品', name: 'ウテナ',         url: 'https://www.utena.co.jp/',              contact: '' },
  { category: '化粧品', name: 'ノエビア',       url: 'https://www.noevir.co.jp/',             contact: 'https://www.noevir.co.jp/custom/shouhin.aspx' },
  // 旧 sofina.co.jp は花王ブランド総覧（Kao Beauty Brands）向け。ブランド専用は SOFINA iP 公式
  { category: '化粧品', name: 'ソフィーナ',     url: 'https://www.kao-kirei.com/ja/official/sofina-ip/', contact: 'https://www.kao.com/jp/support/products/consumer/' },
  // 花王 ブランドコスメ（My Kao Mall）— 問い合わせは花王コンシューマー窓口に統一
  { category: '化粧品', name: 'プリマヴィスタ',       url: 'https://www.kao-kirei.com/ja/official/sofina-primavista/',     contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'ソフィーナ シンクプラス', url: 'https://www.kao-kirei.com/ja/official/sofina-syncplus/',  contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'プリマヴィスタ ディア', url: 'https://www.kao-kirei.com/ja/brand/kbb/primavistadea/',     contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'ソフィーナ ボーテ',     url: 'https://www.kao-kirei.com/ja/brand/kbb/sofina-beaute/',      contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'ソフィーナ グレイス',   url: 'https://www.kao-kirei.com/ja/brand/kbb/sofina-grace/',       contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'ソフィーナ 美容液洗顔', url: 'https://www.kao-kirei.com/ja/brand/kbb/sofina-cleanse/',     contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'ソフィーナ リフト',     url: 'https://www.kao-kirei.com/ja/brand/kbb/sofina-lift/',        contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'アルブラン',           url: 'https://www.kao-kirei.com/ja/brand/kbb/alblanc/',           contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'アリィー',             url: 'https://www.kao-kirei.com/ja/brand/kbb/allie/',             contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'オーブ',               url: 'https://www.kao-kirei.com/ja/brand/kbb/aube/',              contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'ビューティワークス',   url: 'https://www.kao-kirei.com/ja/brand/kbb/beauty-works/',      contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'コフレドール',         url: 'https://www.kao-kirei.com/ja/brand/kbb/coffretdor/',        contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'DEW スペリア',         url: 'https://www.kao-kirei.com/ja/brand/kbb/dew-superior/',      contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'DEW',                  url: 'https://www.kao-kirei.com/ja/brand/kbb/dew/',               contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'エスト',               url: 'https://www.kao-kirei.com/ja/brand/kbb/est/',                contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'エビータ',             url: 'https://www.kao-kirei.com/ja/brand/kbb/evita/',             contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'エクセランス',         url: 'https://www.kao-kirei.com/ja/brand/kbb/exellence/',           contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'ファインフィット',     url: 'https://www.kao-kirei.com/ja/brand/kbb/finefit/',            contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'フリープラス',         url: 'https://www.kao-kirei.com/ja/brand/kbb/freeplus/',          contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'ケイト',               url: 'https://www.kao-kirei.com/ja/brand/kbb/kate/',               contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'リクイール',           url: 'https://www.kao-kirei.com/ja/brand/kbb/lequil/',            contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'リサージ',             url: 'https://www.kao-kirei.com/ja/brand/kbb/lissage/',           contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'リサージ メン',        url: 'https://www.kao-kirei.com/ja/brand/kbb/lissage-men/',       contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'ルナソル',             url: 'https://www.kao-kirei.com/ja/brand/kbb/lunasol/',           contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'メディア',             url: 'https://www.kao-kirei.com/ja/brand/kbb/media/',               contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'ミラノコレクション',   url: 'https://www.kao-kirei.com/ja/brand/kbb/milano-collection/', contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'センサイ',             url: 'https://www.kao-kirei.com/ja/brand/kbb/sensai/',             contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'スイサイ',             url: 'https://www.kao-kirei.com/ja/brand/kbb/suisai/',             contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'トワニー',             url: 'https://www.kao-kirei.com/ja/brand/kbb/twany/',              contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'TWANY ＆me',           url: 'https://www.kao-kirei.com/ja/brand/kbb/twany-andme/',        contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: 'アンリクス',           url: 'https://www.kao-kirei.com/ja/brand/kbb/unlics/',            contact: 'https://www.kao.com/jp/support/products/consumer/' },
  { category: '化粧品', name: '鉄舟コレクション',     url: 'https://www.kao-kirei.com/ja/brand/kbb/tessyu/',            contact: 'https://www.kao.com/jp/support/products/consumer/' },
  // サプリメント
  { category: 'サプリメント', name: 'オリヒロ',             url: 'https://www.orihiro.co.jp/',      contact: '' },
  // fine-j.net は利用不可。公式ECは fine-kagaku.co.jp（ファインオンラインショップ）
  { category: 'サプリメント', name: 'ファイン',             url: 'https://www.fine-kagaku.co.jp/', contact: 'https://www.fine-kagaku.co.jp/Form/Inquiry/InquiryInput.aspx' },
  { category: 'サプリメント', name: 'ハウスウェルネスフーズ', url: 'https://www.house-wf.co.jp/',   contact: '' },
  { category: 'サプリメント', name: 'マイプロテイン',       url: 'https://www.myprotein.jp/',       contact: '' },
  { category: 'サプリメント', name: 'DNS',                  url: 'https://www.dnszone.jp/',         contact: '' },
  { category: 'サプリメント', name: '明治',                 url: 'https://www.meiji.co.jp/',        contact: '' },
  { category: 'サプリメント', name: 'アリナミン製薬',       url: 'https://alinamin.jp/',            contact: '' },
  { category: 'サプリメント', name: 'キユーピー',           url: 'https://www.kewpie.co.jp/',       contact: '' },
  // ウォーターサーバー
  { category: 'ウォーターサーバー', name: 'アルピナウォーター', url: 'https://www.alpina-water.co.jp/', contact: '' },
  { category: 'ウォーターサーバー', name: 'ウォータースタンド', url: 'https://www.waterstand.jp/',      contact: '' },
  { category: 'ウォーターサーバー', name: '日田天領水',         url: 'https://www.tenryo-water.jp/',    contact: '' },
  // 旧 hawaiian-water.jp 接続不可。公式はピュアハワイアン（Toell）
  { category: 'ウォーターサーバー', name: 'ハワイアンウォーター', url: 'https://www.hawaiiwater.co.jp/', contact: 'https://www.hawaiiwater.co.jp/contact/' },
];

/** QVC: シートにない企業名の候補だけ列挙（一覧ページのパースのみ） */
async function discoverQvcCandidates(existingNames) {
  const candidates = [];

  for (const { label, url } of QVC_BRAND_LIST_URLS) {
    log(`  [QVC/${label}・発見] ブランド一覧取得中...`);

    let html;
    try {
      html = await fetchHtml(url);
    } catch (err) {
      log(`    ⚠️  取得失敗: ${err.message}`);
      continue;
    }

    const brandLinks = new Map();
    const re = /href="(https:\/\/qvc\.jp\/catalog\/bList\.html\?baseRo=brand_(\d+)[^"]*?)"[^>]*?>\s*([\s\S]{2,80}?)\s*<\/a>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const [, fullUrl, id, rawName] = m;
      const name = rawName.replace(/\s+/g, ' ').trim();
      if (!brandLinks.has(id) && name.length > 0 && !name.includes('<')) {
        const cleanUrl = fullUrl.split('&')[0];
        brandLinks.set(id, { name, href: cleanUrl });
      }
    }

    log(`    → 一覧上 ${brandLinks.size} ブランド（シート未掲載名のみ候補化）`);

    for (const { name } of brandLinks.values()) {
      if (QVC_SKIP_BRANDS.has(name)) continue;
      const key = normalizeBrandNameKey(name);
      if (existingNames.has(key)) continue;
      const known = QVC_KNOWN_BRANDS[name];
      let category = known?.category;
      if (!category) {
        category = inferSupplementOrWaterCategory(name);
      }
      if (!category) {
        category = /ヘルス/.test(label) ? 'サプリメント' : '化粧品';
      }
      candidates.push({
        source: 'qvc',
        name,
        category,
        known,
      });
    }
  }

  log(`    QVC候補: ${candidates.length} 件`);
  return candidates;
}

/** QVCを先、同一企業名は1件にまとめる */
function mergeTvCandidatesOrdered(qvcList, scList) {
  const seen = new Set();
  const out = [];
  for (const c of qvcList) {
    const k = normalizeBrandNameKey(c.name);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  for (const c of scList) {
    const k = normalizeBrandNameKey(c.name);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/**
 * フェーズ2: 公式URLが取れた候補から行を組み立てる（連絡先が空でもURLがあれば行を作る）
 * @param {number} limitPerRun Infinity または ENV LIMIT（今回追記する行数の上限）
 */
async function resolveAndBuildTvRows(candidates, existingUrls, limitPerRun) {
  const rows = [];
  const seenOfficialThisRun = new Set();
  const lim = Number.isFinite(limitPerRun) && limitPerRun > 0 ? limitPerRun : Infinity;

  log('\n  ── フェーズ2: 公式URLの解決〜連絡先取得（取得できた行からシートへ） ──');

  for (const candidate of candidates) {
    if (rows.length >= lim) {
      log(`    （LIMIT=${lim} によりここで打ち切り）`);
      break;
    }

    const { name, category, known, source } = candidate;
    const cat = known?.category || category;
    let officialUrl = known?.url || '';

    if (!officialUrl) {
      const waitMs = source === 'qvc' ? 4000 + Math.random() * 3000 : 3000 + Math.random() * 2000;
      await delay(waitMs);
      officialUrl = await searchOfficialSite(name);
    }

    if (!officialUrl) {
      log(`    ⚠️  ${name}: 公式URL未取得`);
      continue;
    }

    if (existingUrls.has(officialUrl) || seenOfficialThisRun.has(officialUrl)) {
      log(`    → ${name}: URL既存のためスキップ (${officialUrl})`);
      continue;
    }

    if (!known) {
      const valid = await validateBrandNameOnly(officialUrl, name, cat);
      if (!valid) {
        log(`    ⚠️  ${name}: URL検証NG (${officialUrl})`);
        continue;
      }
    }

    let contact = known?.contact || '';
    if (!contact) {
      contact = await fetchContactInfo(officialUrl);
    }

    const rowName = known?.sheetName || name;
    seenOfficialThisRun.add(officialUrl);
    rows.push([cat, rowName, officialUrl, contact || '']);
    const aliasNote = rowName !== name ? `（SC表記: ${name}）` : '';
    log(`    ✓ ${rowName} → ${officialUrl}${aliasNote}${contact ? ` [${contact}]` : ' （連絡先なし・要手動）'}`);
  }

  return rows;
}

// カテゴリ別キーワード（いずれか1つでも含まれていれば該当とみなす）
const CATEGORY_KEYWORDS = {
  '化粧品': ['化粧品', 'スキンケア', '美容液', '化粧水', '乳液', '洗顔', 'コスメ', 'ファンデーション', 'メイク', '美容', '化粧', 'クリーム', '美白', 'エイジング', '保湿', 'skincare', 'cosmetic'],
  'サプリメント': ['サプリメント', 'サプリ', '健康食品', '栄養補助', 'ビタミン', 'ミネラル', 'プロテイン', 'コラーゲン', '乳酸菌', 'アミノ酸', '健康補助', '栄養素', '機能性食品', '栄養', '免疫', 'ハチミツ', '蜂蜜', '天然素材', '健康维持'],
  'ウォーターサーバー': ['ウォーターサーバー', '宅配水', '天然水', 'ミネラルウォーター', 'お水のお届け', 'ウォーター', '水サーバー'],
};

/** ブランド公式として採用しないドメイン断片（メディア・他業種・検索ノイズ） */
const UNOFFICIAL_HOST_MARKERS = [
  'cnet.com', 'espncricinfo', 'cricinfo', 'tabelog.', 'disney.', 'hinative.', 'skyscanner.',
  'nintendo.', 'pixiv.', 'sogou.', 'zhihu.', 'baidu.', 'xnxx.', 'mynavi.', 'nikkansports',
  'eiga.com', 'bbc.co', 'cnn.com', 'abc7.com', 'instagram.', 'tiktok.', 'tsurihack.',
  'kakeru-news', 'ichikawaen.co.jp', 'ricawax.', 'realnetpro', 'medi-japan.co.jp',
  'biteki.com', 'lilly.co.jp', 'jlgo.lilly', 'utaten.com', 'dic.pixiv', 'kanjitisiki.com',
  'lamour-clinic', 'at-s.com', 'woman.mynavi', 'delishkitchen', 'gold.tanaka',
  'mptenders.gov.in', 'aqlier.com', 'zukan-bouz', 'xeex.co.jp', 'ovtp.jp', 'tribe-m.jp',
  'ninedesign.jp', 'piyojapan.com', 'artscape.jp', 'three-aomori.jp', 'wenwen.sogou',
  'support.nintendo', 'shigagolfclub', 'nagoyamineral', 'lecreuset.co.jp', 'ufu-sweets',
  'ieagent.jp', 'spur.hpplus.jp', 'beams.co.jp', 'nanos.jp', 'kokka.jp', 'lala.ne.jp',
];

function hostnameLooksUntrustworthy(host) {
  const h = host.toLowerCase();
  return UNOFFICIAL_HOST_MARKERS.some((m) => h.includes(m));
}

/** script/style 除去後にタグを剥がし、本文ラフ全文検索用 */
function stripToVisibleText(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

/** ブランド文字列から英字トークン（括弧内 ROMAN 含む） */
function extractLatinBrandTokens(brandName) {
  const out = new Set();
  const s = brandName.replace(/[・･]/g, ' ');
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9-]*/g)) {
    const t = m[0].replace(/-/g, '').toLowerCase();
    if (t.length >= 3) out.add(t);
  }
  for (const m of s.matchAll(/\(([A-Za-z0-9\s.-]+)\)/g)) {
    for (const part of m[1].split(/[\s/]+/)) {
      const t = part.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
      if (t.length >= 3) out.add(t);
    }
  }
  return [...out];
}

/** ホスト名・パス（英字のみ潰して）にブランドの英字トークンが入るか */
function hostOrPathSuggestsBrand(host, pathname, brandName) {
  const collapsed = `${host}${pathname}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const t of extractLatinBrandTokens(brandName)) {
    if (t.length >= 3 && collapsed.includes(t)) return true;
  }
  return false;
}

/** <title> にブランド表記が十分含まれるか */
function titleReflectsBrand(titleText, core) {
  if (!titleText || !core) return false;
  const cn = core.replace(/\s+/g, '').normalize('NFKC');
  const tn = titleText.replace(/\s+/g, '').normalize('NFKC');
  if (tn.includes(cn)) return true;
  const asciiCore = cn.replace(/[^\x00-\x7F]/g, '');
  if (asciiCore.length >= 3) {
    const tl = titleText.toLowerCase();
    const cl = cn.toLowerCase();
    if (tl.includes(cl)) return true;
  }
  const prefixLen = cn.length >= 6 ? 6 : cn.length >= 5 ? 5 : 0;
  if (prefixLen >= 5 && tn.includes(cn.slice(0, prefixLen))) return true;
  return false;
}

/**
 * ブランド名と URL（ホスト・本文）の整合を確認。明らかに無関係なドメインは除外。
 * @param {string} category 化粧品 / サプリメント / ウォーターサーバー
 */
async function validateBrandNameOnly(url, brandName, category) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (hostnameLooksUntrustworthy(host)) return false;

    const core = brandName.replace(/[（(][^）)]+[）)]/g, '').trim();
    if (!core) return false;

    const path = (u.pathname || '').toLowerCase();
    const html = await fetchHtml(url);

    const titleM = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
    const title = titleM ? titleM[1].replace(/\s+/g, ' ').trim() : '';

    const visible = stripToVisibleText(html);
    const headSnippet = visible.slice(0, 65000);

    const catKws = CATEGORY_KEYWORDS[category] || [];
    const categorySignal =
      catKws.length === 0 || catKws.some((kw) => headSnippet.includes(kw) || title.includes(kw));

    const latinInUrl = hostOrPathSuggestsBrand(host, path, brandName);
    const titleOk = titleReflectsBrand(title, core);
    const bodyHasFullBrand = headSnippet.includes(core);
    const bodyHasLongPrefix =
      core.length >= 6 ? headSnippet.includes(core.slice(0, 6)) : false;

    if (latinInUrl) {
      if (!(titleOk || bodyHasFullBrand || (bodyHasLongPrefix && core.length >= 6))) return false;
      return categorySignal;
    }

    if (titleOk) return categorySignal;
    if (bodyHasFullBrand) return categorySignal;
    if (core.length >= 5 && headSnippet.includes(core.slice(0, 5)) && categorySignal) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * 見つかったURLのサイトにブランド名 + カテゴリキーワードが含まれるか検証
 */
async function validateBrandSite(url, brandName, category) {
  try {
    const html = await fetchHtml(url);
    // ブランド名の最初の4文字（カタカナ・漢字）でチェック
    const core = brandName.replace(/[（(][^）)]+[）)]/g, '').trim().slice(0, 4);
    if (!html.includes(core)) return false;
    // カテゴリキーワードが1つもなければ除外
    const keywords = CATEGORY_KEYWORDS[category] || [];
    if (keywords.length > 0 && !keywords.some(kw => html.includes(kw))) return false;
    return true;
  } catch {
    return false;
  }
}

export async function searchOfficialSite(brandName) {
  // QVC・楽天・Amazon等のECサイトを除外するドメイン
  const EXCLUDE = ['qvc.jp', 'rakuten', 'amazon', 'yahoo', 'google', 'instagram',
    'twitter', 'facebook', 'youtube', 'wikipedia', 'cosme', 'minne', 'mercari',
    'zozo', 'beauty', 'itmedia', 'goo.ne', 'excite', 'livedoor',
    'weblio', 'zhihu', 'baidu', 'naver', 'pinterest', 'tiktok', 'line.me',
    'bing.com', 'microsoft.com', 'apple.com', 'app.adjust', 'duckduckgo.com',
    'cnet.com', 'espncricinfo', 'tabelog.', 'cricinfo', 'mynavi.', 'pixiv.',
    'tabelog.jp', 'hinative.', 'skyscanner.', 'sogou.', 'woman.mynavi'];

  const shortName = brandName.replace(/[（(][^）)]{1,20}[）)]/g, '').trim();

  // Bing / Yahoo Japan を順に試す
  const SEARCH_ENGINES = [
    {
      name: 'Bing',
      buildUrl: (q) => `https://www.bing.com/search?q=${q}&mkt=ja-JP`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'ja',
      },
    },
    {
      name: 'Yahoo',
      buildUrl: (q) => `https://search.yahoo.co.jp/search?p=${q}&ei=UTF-8`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'ja-JP,ja',
      },
    },
  ];

  for (const engine of SEARCH_ENGINES) {
    try {
      const q = encodeURIComponent(`"${shortName}" 公式サイト OR 公式通販`);
      const res = await fetch(engine.buildUrl(q), {
        headers: engine.headers,
        signal: AbortSignal.timeout(15000),
      });
      const html = await res.text();

      // <cite> タグからURL抽出（https://あり・なし両対応）
      const cites = [...html.matchAll(/<cite[^>]*>([^<]{4,200})<\/cite>/gi)]
        .map(m => {
          const raw = m[1].trim().split('›')[0].trim().replace(/\/$/, '');
          if (!raw) return null;
          if (raw.startsWith('http')) return raw + '/';
          if (raw.match(/^[\w.-]+\.[a-z]{2,}/i)) return 'https://' + raw + '/';
          return null;
        })
        .filter(Boolean);

      const candidates = [...new Set(cites)].filter((u) => {
        let hostname = '';
        try {
          hostname = new URL(u).hostname.toLowerCase();
        } catch {
          return false;
        }
        if (hostnameLooksUntrustworthy(hostname)) return false;
        const ul = u.toLowerCase();
        return !EXCLUDE.some((ex) => ul.includes(ex));
      });

      if (candidates.length > 0) return candidates[0];

      // 結果なし → 次のエンジンへ（少し待機）
      await delay(2000 + Math.random() * 1000);
    } catch {
      // 次のエンジンへ
    }
  }

  return null;
}

// ── 自社通販ブランドの問い合わせ情報を取得 ────────────────────────────
/** 環境変数 OWN_LIMIT_PER_CATEGORY（例: 20）でカテゴリごとに今回追記する件数の上限 */
function getOwnLimitPerCategory() {
  const raw = process.env.OWN_LIMIT_PER_CATEGORY;
  if (!raw) return Infinity;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}

/** 環境変数 OWN_TOTAL_LIMIT（例: 20）で今回の追記合計の上限（リスト先頭から順に埋める） */
function getOwnTotalLimit() {
  const raw = process.env.OWN_TOTAL_LIMIT;
  if (!raw) return Infinity;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}

async function scrapeOwnBrands(existingUrls) {
  const rows = [];
  const lim = getOwnLimitPerCategory();
  const totalLim = getOwnTotalLimit();
  const appendedByCat = { 化粧品: 0, サプリメント: 0, ウォーターサーバー: 0 };

  if (lim !== Infinity) {
    log(`  （カテゴリ別上限: 各 ${lim} 件まで今回追記・OWN_LIMIT_PER_CATEGORY）`);
  }
  if (totalLim !== Infinity) {
    log(`  （合計上限: ${totalLim} 件まで今回追記・OWN_TOTAL_LIMIT）`);
  }

  for (const { category, name, url, contact: knownContact } of OWN_BRANDS) {
    if (totalLim !== Infinity && rows.length >= totalLim) {
      log(`    （OWN_TOTAL_LIMIT=${totalLim} によりここで打ち切り）`);
      break;
    }
    if (!Object.prototype.hasOwnProperty.call(appendedByCat, category)) {
      log(`  ⚠️  [自社通販] 未対応カテゴリをスキップ: ${category} (${name})`);
      continue;
    }
    if (appendedByCat[category] >= lim) continue;

    if (existingUrls.has(url)) continue;
    await delay(700 + Math.random() * 500);

    // 既知の問い合わせURLがあればそれを使用、なければ自動取得
    let contact = knownContact || '';
    if (!contact) {
      contact = await fetchContactInfo(url);
    }
    if (!contact) {
      log(`  ⚠️  [自社通販] ${name}: 問い合わせ先見つからず (保留)`);
      continue;
    }
    rows.push([category, name, url, contact]);
    appendedByCat[category]++;
    log(`  ✓ [自社通販] ${name} - ${contact}`);
  }

  if (lim !== Infinity) {
    log(`  今回のカテゴリ別追記: 化粧品 ${appendedByCat['化粧品']} / サプリ ${appendedByCat['サプリメント']} / 水 ${appendedByCat['ウォーターサーバー']} 件（各上限 ${lim}）`);
  }

  return rows;
}

/**
 * TVショッピング・フェーズ1のみ（候補列挙。URL解決・シート追記なし）
 * `node scrape-tv.mjs --phase1-only` / `node main.mjs --only=tv --phase1-only`
 */
export async function scrapeTvPhase1Only() {
  log('\n📺 TVショッピング 【フェーズ1のみ】候補発見（追記・検索は行いません）');
  const existingTvUrls = await getExistingUrls(TV_SHEET);
  const existingTvNames = await getExistingNames(TV_SHEET);
  log(`  シート既存: URL ${existingTvUrls.size} 件 / 企業名 ${existingTvNames.size} 件（B列）`);

  log('\n  ── フェーズ1: 対象カテゴリのうち、まだシートにない企業を列挙 ──');
  const qvcCandidates = await discoverQvcCandidates(existingTvNames);
  const scCandidates = await discoverShopChannelCandidates(existingTvNames);
  const merged = mergeTvCandidatesOrdered(qvcCandidates, scCandidates);
  log(`  候補合計（名前ユニーク・QVC優先）: ${merged.length} 件`);

  const preview = 50;
  log('\n  ── 候補一覧（先頭のみ表示） ──');
  merged.slice(0, preview).forEach((c, i) => {
    const tag = c.known?.url ? ' ※既知URL' : '';
    log(`    ${String(i + 1).padStart(3, ' ')}. [${c.source}] ${c.name} （${c.category}）${tag}`);
  });
  if (merged.length > preview) {
    log(`    … 他 ${merged.length - preview} 件`);
  }

  writeLatestSummary({
    title: 'TV収集サマリー',
    overview: [
      { label: '実行モード', value: 'phase1-only' },
      { label: '対象シート', value: TV_SHEET },
    ],
    metrics: [
      { label: '既存URL件数', value: `${existingTvUrls.size}件` },
      { label: '既存企業名件数', value: `${existingTvNames.size}件` },
      { label: 'QVC候補数', value: `${qvcCandidates.length}件` },
      { label: 'ショップチャンネル候補数', value: `${scCandidates.length}件` },
      { label: '候補合計', value: `${merged.length}件` },
    ],
    sections: [
      {
        heading: '候補プレビュー',
        lines: merged.slice(0, preview).map((c, i) => {
          const tag = c.known?.url ? ' ※既知URL' : '';
          return `- ${i + 1}. [${c.source}] ${c.name} （${c.category}）${tag}`;
        }),
      },
      {
        heading: '次の実行',
        lines: ['- node scrape-tv.mjs', '- node main.mjs --only=tv'],
      },
    ],
  });

  log('\n  フェーズ2（公式URL・連絡先・シート追記）は未実行です。');
  return merged.length;
}

// ── メイン（TVショッピングシートのみ。自社通販は scrapeOwn / main の次段で実行） ──
export async function scrapeTv() {
  log('\n📺 TVショッピング 収集開始（①候補発見 → ②URL解決・追記）');
  const existingTvUrls = await getExistingUrls(TV_SHEET);
  const existingTvNames = await getExistingNames(TV_SHEET);
  log(`  シート既存: URL ${existingTvUrls.size} 件 / 企業名 ${existingTvNames.size} 件（B列）`);

  log('\n  ── フェーズ1: 対象カテゴリのうち、まだシートにない企業を列挙 ──');
  const qvcCandidates = await discoverQvcCandidates(existingTvNames);
  const scCandidates = await discoverShopChannelCandidates(existingTvNames);
  const merged = mergeTvCandidatesOrdered(qvcCandidates, scCandidates);
  log(`  候補合計（名前ユニーク・QVC優先）: ${merged.length} 件`);

  const skipPhase2 = getPhase2SkipBrandKeys();
  let mergedForResolve = merged;
  if (skipPhase2.size > 0) {
    mergedForResolve = merged.filter((c) => !skipPhase2.has(normalizeBrandNameKey(c.name)));
    const nExcluded = merged.length - mergedForResolve.length;
    if (nExcluded > 0) {
      log(`  フェーズ2除外: ${nExcluded} 件（--skip-brand / TV_SKIP_PHASE2）`);
    }
  }

  const limitPerRun = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
  const tvRows = await resolveAndBuildTvRows(mergedForResolve, existingTvUrls, limitPerRun);

  await appendRows(TV_SHEET, tvRows);
  writeLatestSummary({
    title: 'TV収集サマリー',
    overview: [
      { label: '実行モード', value: 'collect' },
      { label: '対象シート', value: TV_SHEET },
      { label: '追記上限', value: Number.isFinite(limitPerRun) ? `${limitPerRun}件` : '制限なし' },
    ],
    metrics: [
      { label: '既存URL件数', value: `${existingTvUrls.size}件` },
      { label: '既存企業名件数', value: `${existingTvNames.size}件` },
      { label: '候補合計', value: `${merged.length}件` },
      { label: 'フェーズ2対象', value: `${mergedForResolve.length}件` },
      { label: '追記件数', value: `${tvRows.length}件` },
    ],
    sections: [
      {
        heading: '収集メモ',
        lines: [
          `- フェーズ2除外件数: ${Math.max(merged.length - mergedForResolve.length, 0)}件`,
          '- QVC優先で候補を統合',
          '- URL解決後に問い合わせ先を取得して追記',
        ],
      },
    ],
  });
  log(`\n  → 「${TV_SHEET}」: ${tvRows.length} 件追記`);
  return tvRows.length;
}

// 自社通販のみ実行（--only=own 用）
export async function scrapeOwn() {
  log('\n🏠 自社通販 収集開始');
  const existingOwn = await getExistingUrls(OWN_SHEET);
  const ownRows = await scrapeOwnBrands(existingOwn);
  await appendRows(OWN_SHEET, ownRows);
  writeLatestSummary({
    title: '自社通販収集サマリー',
    overview: [
      { label: '実行モード', value: 'collect' },
      { label: '対象シート', value: OWN_SHEET },
    ],
    metrics: [
      { label: '既存URL件数', value: `${existingOwn.size}件` },
      { label: '追記件数', value: `${ownRows.length}件` },
    ],
    sections: [
      {
        heading: '収集メモ',
        lines: [
          '- 主要ブランド直販サイトを対象に追加',
          '- 既存URLは重複追加しない',
        ],
      },
    ],
  });
  log(`  → 自社通販: ${ownRows.length} 件追記`);
  return ownRows.length;
}

// 単体実行: node scrape-tv.mjs [--phase1-only]
if (process.argv[1]?.endsWith('scrape-tv.mjs')) {
  const phase1 = process.argv.includes('--phase1-only');
  const run = phase1 ? scrapeTvPhase1Only : scrapeTv;
  run()
    .then((n) => log(`\n完了: ${phase1 ? `候補 ${n} 件（フェーズ1のみ・追記なし）` : `${n} 件追記`}`))
    .catch(console.error);
}
