/**
 * _template.mjs — research.mjs 用 config のテンプレート集
 *
 * このファイルは import ではなく「設定例の辞書」として使う。
 * エージェントが新しいリサーチを構築するとき、ここのサンプルを参考にする。
 *
 * 実行方法:
 *   1. config を JS で組み立てて JSON に変換
 *   2. node tools/research.mjs --config config.json
 *
 * または、Phase 3 の save-as-script でこのパターンを
 * scrapers/<名前>.mjs として保存できる(その場合は専用スクリプトとして実行)
 */

/**
 * パターン1: list-detail モード(食べログ風の一覧→詳細巡回)
 */
export const sampleListDetail = {
  name: "新宿_居酒屋",
  mode: "list-detail",
  sheetName: null, // null なら yyyyMMdd_<name> で自動生成
  maxItems: 50,
  throttle: {
    delayMs: 2500,
    jitterMs: 1000,
  },
  list: {
    // 最初にアクセスする URL(複数可)
    urls: ["https://example.com/list/page1"],
    // ページネーション: "{page}" を startPage〜maxPages で置換
    pagination: {
      urlTemplate: "https://example.com/list/page{page}",
      startPage: 2,
      maxPages: 3,
    },
    mode: "auto", // auto / static / browser
    // 一覧ページの各項目要素を指すセレクタ
    itemSelector: ".item-card",
    // 各項目から title / url を抽出する設定
    parseItem: {
      title: { selector: ".item-name", extract: "text" },
      url: { selector: "a.item-link", extract: "attr", attr: "href" },
      // ここで一覧ページから取れる補助情報があれば追加(例: 一覧時点で評価点数が見えるなど)
      評価: { selector: ".rating", extract: "text" },
    },
  },
  // 詳細ページで取る情報(省略可。省略時は list.parseItem のみで確定)
  detail: {
    mode: "auto",
    fields: {
      住所: { selector: ".address", extract: "text" },
      電話番号: { selector: ".tel a", extract: "text" },
      ジャンル: { selector: ".category", extract: "text" },
      席数: { selector: "dt:contains('席数') + dd", extract: "text" },
    },
  },
};

/**
 * パターン2: single モード(少数URLから情報取得)
 * 競合調査などに向く
 */
export const sampleSingle = {
  name: "競合3社_製品ページ",
  mode: "single",
  maxItems: 10,
  urls: [
    "https://competitor-a.com/product",
    "https://competitor-b.com/product",
    "https://competitor-c.com/product",
  ],
  fields: {
    title: { selector: "h1", extract: "text" },
    価格: { selector: ".price", extract: "text" },
    説明: { selector: "meta[name=description]", extract: "attr", attr: "content" },
  },
};

/**
 * パターン3: search-based モード(Brave検索→ヒット先巡回)
 * 営業先リサーチ(「◯◯ ホームページ」で検索→各社サイト訪問)に向く
 */
export const sampleSearchBased = {
  name: "新宿_居酒屋_検索経由",
  mode: "search-based",
  query: "新宿 居酒屋 ホームページ",
  searchMax: 30,
  searchOptions: {
    country: "jp",
    freshness: null, // pd / pw / pm / py で期間指定可
  },
  detail: {
    mode: "auto",
    fields: {
      説明: { selector: "meta[name=description]", extract: "attr", attr: "content" },
      電話番号: { selector: "[href^='tel:']", extract: "attr", attr: "href" },
      メールアドレス: { selector: "[href^='mailto:']", extract: "attr", attr: "href" },
    },
  },
};

/**
 * パターン4: places モード(Google Places API で店舗情報を一括取得)
 *
 * ★電話番号・住所・営業時間を合法的に取得したいときの第一選択★
 *
 * 対象: 飲食店、美容室、医療機関、小売店、士業事務所など「Google に登録されている店舗型ビジネス」
 * 利点: Web スクレイピングと違い、電話番号・公式サイト・営業時間が確実に取れる
 * 料金: Google Maps Platform の従量課金(無料クレジット $200/月 あり、目安として数千件/月は無料内)
 */
export const samplePlaces = {
  name: "新宿_居酒屋_places",
  mode: "places",
  query: "新宿区 居酒屋", // 自然言語で検索(「○○区 業種」が効きやすい)
  maxItems: 50, // Places API の仕様上、上限60
  placesOptions: {
    languageCode: "ja",
    regionCode: "jp",
    // openNow: true,        // 「今営業中」でフィルタしたい場合
    // minRating: 3.5,       // 最低評価フィルタ
    // locationBias: {       // 位置ベースの絞り込み(半径メートル)
    //   latitude: 35.6895,
    //   longitude: 139.6917,
    //   radius: 3000,
    // },
  },
  // 出力列のカスタマイズ(省略可、省略時は下記がデフォルト)
  fieldMapping: {
    店名: "name",
    住所: "address",
    電話番号: "phone",
    公式サイト: "website",
    評価: "rating",
    レビュー数: "userRatingCount",
    営業時間: "hours",
    GoogleMaps: "mapsUrl",
    営業状態: "businessStatus",
  },
};

/**
 * パターン5: 無限スクロール対応(X, Instagram のようなタイムライン型)
 */
export const sampleInfiniteScroll = {
  name: "サンプル_無限スクロール",
  mode: "list-detail",
  maxItems: 30,
  list: {
    urls: ["https://example.com/feed"],
    mode: "browser",
    browserOptions: {
      scroll: "full", // 最後までスクロール
      waitForSelector: ".post",
      waitAfterLoadMs: 2000,
    },
    itemSelector: ".post",
    parseItem: {
      title: { selector: ".post-title", extract: "text" },
      url: { selector: ".post-link", extract: "attr", attr: "href" },
    },
  },
};
