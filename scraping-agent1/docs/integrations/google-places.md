# Google Places API (New) 連携メモ

## 概要

- **サービス名**: Google Maps Platform — Places API (New)
- **用途**: 飲食・美容・医療・小売など店舗型ビジネスの電話番号・住所・営業時間・評価の一括取得
- **公式サイト**: https://mapsplatform.google.com/
- **公式ドキュメント**: https://developers.google.com/maps/documentation/places/web-service/overview
- **API 名**: Places API (New) — Text Search エンドポイント
- **追加日**: 2026-04-20
- **コネクタファイル**: `tools/lib/google-places.mjs`

## 料金

- **無料枠**: Google Maps Platform 全体で月 $200 のクレジットが自動付与(2026年4月時点)
- **Text Search の単価**: 目安で $0.032 / リクエスト(1ページ最大20件)
  - つまり無料クレジット内だけで月 6,000+ リクエスト ≒ 100,000+ 件の取得が可能
- **課金条件**: 無料クレジットを超過すると、Cloud Billing アカウントに請求
- **クレジットカード登録**: 必須(Cloud Billing 有効化が前提)
- **想定月額(受講生の使い方)**: 実質 0 円(無料クレジット内で収まる)
- **予算アラート**: Google Cloud Console → 「お支払い」→「予算とアラート」で月 $10 の上限通知を設定推奨

## コネクタへの料金登録(PRICING_META)

`tools/lib/google-places.mjs` のモジュールロード時に登録している値:

```javascript
registerApi("google-places", {
  label: "Google Places API (New)",
  priceModel: "per-request",
  pricePerRequest: 0.032,
  currency: "USD",
  freeTier: {
    description: "Google Maps Platform 月 $200 無料クレジット(Cloud Billing 連携時)",
    limit: null,
    limitUsd: 200,
  },
  dashboardUrl: "https://console.cloud.google.com/billing",
  note: "単価は目安。正確な請求は Cloud Console の請求レポートで確認",
});
```

- **単価を見直すとき**: 上記 `pricePerRequest` を調整する(Google の料金体系が変わった場合や、Essentials/Pro/Enterprise を使い分ける場合)
- **FieldMask を縮める場合**: Essentials 相当で $0.017/req などに下げることも可能(ただし `nationalPhoneNumber` / `websiteUri` を抜くと電話番号・サイトが取れない)

## 認証方式

- API Key(ヘッダー `X-Goog-Api-Key`)
- `.env` のキー名: `GOOGLE_PLACES_API_KEY`

## API キーの発行手順

### ステップ 1. Google Cloud Console にログイン

1. ブラウザで https://console.cloud.google.com/ を開く
2. Google アカウントでログイン

### ステップ 2. プロジェクトを選ぶ / 作る

1. 画面上部の「プロジェクトを選択」ドロップダウンをクリック
2. 既存プロジェクトがあればそれを選ぶ。なければ「新しいプロジェクト」
3. プロジェクト名(例: `scraping-agent`)を入れて「作成」

### ステップ 3. Places API (New) を有効化

1. 左メニュー(ハンバーガーアイコン)→「APIとサービス」→「ライブラリ」
2. 検索窓に `Places API (New)` と入力
3. 「**Places API (New)**」(※「Places API」ではなく新しい方)を選択
4. 「有効にする」をクリック

### ステップ 4. API キーを発行

1. 左メニュー →「APIとサービス」→「認証情報」
2. 上部「+ 認証情報を作成」→「API キー」
3. ダイアログに表示されたキー(文字列)をコピー
4. 「キーを制限」(推奨):
   - **アプリケーションの制限**: なし(または「HTTP リファラー」でなく「なし」)
   - **API の制限**: 「キーを制限」→ Places API (New) のみにチェック

### ステップ 5. Cloud Billing を有効化

1. 左メニュー →「お支払い」
2. 「請求先アカウントをリンク」または「請求先アカウントを作成」
3. クレジットカード情報を入力(**無料クレジット内は請求されない**)
4. 予算アラートを設定: 「予算とアラート」→「予算を作成」→ 月 $10 で通知

### ステップ 6. `.env` に追加

```env
GOOGLE_PLACES_API_KEY=<ここに貼り付け>
```

## 取得できる主なフィールド

`normalizePlace()` で以下の形に揃えて返している:

| フィールド | 型 | 例 |
|---|---|---|
| `id` | string | `ChIJN1t_tDeuEmsRUsoyG83frY4` |
| `name` | string | `居酒屋〇〇 新宿東口店` |
| `address` | string | `東京都新宿区歌舞伎町1-2-3` |
| `shortAddress` | string | `新宿区歌舞伎町1-2-3` |
| `phone` | string | `03-1234-5678` |
| `phoneInternational` | string | `+81 3-1234-5678` |
| `website` | string(URL) | `https://...` |
| `mapsUrl` | string(URL) | `https://maps.google.com/?cid=...` |
| `rating` | number | `4.2` |
| `userRatingCount` | number | `1523` |
| `priceLevel` | string/null | `PRICE_LEVEL_MODERATE` |
| `hours` | string | `月: 17:00-24:00 / 火: 定休日 / ...` |
| `businessStatus` | string | `OPERATIONAL` / `CLOSED_PERMANENTLY` |
| `types` | string | `japanese_restaurant, bar, food` |
| `primaryType` | string | `居酒屋` |
| `latitude` / `longitude` | number | `35.6895 / 139.6917` |

## レート制限

- **スロットリング**: `MIN_INTERVAL_MS = 200`(200ms 以上空ける、礼儀として)
- **並列**: 可能だが、本ツールでは直列実行
- **1日あたり**: 実質無制限(無料クレジットの範囲内)
- **Next page token**: 最大3ページまで(約60件)取得可能

## 動作確認済みの使用例

### 使用例 1. 新宿の居酒屋

```bash
echo '{
  "name": "新宿_居酒屋_places",
  "mode": "places",
  "query": "新宿区 居酒屋",
  "maxItems": 30,
  "placesOptions": {
    "languageCode": "ja",
    "regionCode": "jp"
  }
}' | node tools/research.mjs --config - --dry-run
```

### 使用例 2. 絞り込み(今営業中、評価 3.5 以上)

```json
{
  "mode": "places",
  "query": "渋谷区 美容室",
  "placesOptions": {
    "openNow": true,
    "minRating": 3.5
  }
}
```

## 規約・利用制約

- **再配布**: Google Maps Platform のデータを Google Maps 以外の地図と組み合わせて表示するのは禁止
- **データ保持期間**: 原則として長期キャッシュは禁止(30日以内を目安)
- **二次利用**: 制約あり。営業リストとして社内利用するのは概ね OK だが、再販は NG
- **表示要件**: 一部のフィールド(レビュー、写真等)は Google の属性表示を併記する必要がある
- **詳細**: https://developers.google.com/maps/terms

## 既知の注意点 / 落とし穴

- 同じ会社で複数支店があると、クエリに「エリア」を足さないと1店舗にマッチしないことがある
- 駅名ピンポイントより、「区」「市」レベルで検索する方が件数が多い
- 医療機関・士業の一部は電話番号が null で返ることがある(公開していないケース)
- `openNow` フィルタは Google 側のデータが不正確な店舗だと弾かれてしまう(特に個人店)

## 関連ファイル

- コネクタ: `tools/lib/google-places.mjs`
- 使い方サンプル: `scrapers/_template.mjs` の `samplePlaces`
- モード実装: `tools/research.mjs` の `runPlaces`
- エンリッチでの利用: `tools/enrich-contact.mjs`(`--use-places` / `--places-only`)
- 環境変数: `.env` / `.env.example` の `GOOGLE_PLACES_API_KEY`
- セットアップ: `setup/SETUP-FOR-CC.md` ステップ 2-C
