# Brave Search API 連携メモ

## 概要

- **サービス名**: Brave Search API
- **用途**: 検索エンジン経由でヒット先を集める(search-based モード)、または「会社名で一覧を作る」用途
- **公式サイト**: https://brave.com/search/api/
- **公式ドキュメント**: https://api.search.brave.com/app/documentation/web-search/get-started
- **API 名**: Brave Search API — Web Search
- **追加日**: 2026-04-20
- **コネクタファイル**: `tools/lib/brave-search.mjs`

## 料金

- **無料枠**: 月 2,000 クエリまで(Data for Search プラン)
- **有料プラン**: $5 / 月〜(Data for AI、追加クエリ)
- **クレジットカード登録**: 無料プランでも必須(1回だけ)
- **想定月額(受講生の使い方)**: 無料プラン(2,000クエリ)で足りる想定
- **QPS 上限**: 1 QPS(Data for Search プラン)

## コネクタへの料金登録(PRICING_META)

`tools/lib/brave-search.mjs` のモジュールロード時に登録している値:

```javascript
registerApi("brave-search", {
  label: "Brave Search API",
  priceModel: "free-tier-quota",
  currency: "USD",
  freeTier: {
    description: "Free プラン: 月 2,000 クエリ無料",
    limit: 2000,
    limitUsd: null,
  },
  dashboardUrl: "https://api.search.brave.com/app/dashboard",
  note: "超過時は有料プラン($5/月〜)への切り替えが必要",
});
```

- `priceModel: "free-tier-quota"` のため、無料枠内はコスト $0 として表示され、残量(`limit - requests`)が自動計算される
- 有料プランに切り替えたときは、`priceModel` を `"per-request"` に変更し、`pricePerRequest` を設定する

## 認証方式

- API Key(ヘッダー `X-Subscription-Token`)
- `.env` のキー名: `BRAVE_SEARCH_API_KEY`

## API キーの発行手順

### ステップ 1. アカウント作成

1. ブラウザで https://brave.com/search/api/ を開く
2. 右上「Sign up」or 「Get Started」をクリック
3. メールアドレスとパスワードで登録 → メール認証

### ステップ 2. プランを選ぶ

1. ダッシュボードに入ったら「Subscription」を選択
2. 「Data for Search Free」を選ぶ(2,000 queries / month)
3. クレジットカード情報を入力(無料プラン利用にも必要)

### ステップ 3. API キー発行

1. 左メニュー「API Keys」をクリック
2. 「Generate API Key」ボタン
3. 表示されたキーをコピー

### ステップ 4. `.env` に追加

```env
BRAVE_SEARCH_API_KEY=<ここに貼り付け>
```

## 取得できる主なフィールド

コネクタの戻り値:

| フィールド | 型 | 例 |
|---|---|---|
| `title` | string | 「株式会社〇〇 - 会社情報」 |
| `url` | string | https://example.com |
| `description` | string | 検索結果のスニペット |
| `age` | string/null | "2 days ago" など |

## レート制限

- **1秒あたり**: 1 QPS(無料プラン)
- **コネクタ側の挙動**: `MIN_INTERVAL_MS = 1100` で自動調整
- **月上限**: 2,000 クエリ(無料プラン)

## 動作確認済みの使用例

### 使用例 1. 「○○ 公式サイト」検索

```bash
node tools/research-helpers.mjs search --query "〇〇株式会社 公式サイト" --max 5
```

### 使用例 2. search-based モード

```json
{
  "mode": "search-based",
  "query": "東京 IT企業 採用",
  "maxItems": 20,
  "detail": {
    "fields": {
      "会社名": { "selector": "h1", "extract": "text" }
    }
  }
}
```

## 規約・利用制約

- **再配布**: API レスポンスの直接再配布は禁止
- **キャッシュ**: 短期間(24時間以内)の範囲で可
- **二次利用**: 商用利用可(プランに応じる)
- **スクレイピング目的での利用**: 検索結果から取得した URL をスクレイピングするのは、**スクレイピング先のサイトの規約に依存**(Brave 自体は OK)

## 既知の注意点 / 落とし穴

- 同じクエリで検索しても日によって結果順序が微妙に変わる
- 日本語クエリは英語版より結果が少ないことがある(`country=JP` パラメータを入れてもダメなケースあり)
- ヒット件数が少ない地域(地方)では結果が数件しか返らない

## 関連ファイル

- コネクタ: `tools/lib/brave-search.mjs`
- search-based モード: `tools/research.mjs` の `runSearchBased`
- 補助コマンド: `tools/research-helpers.mjs search`
- 環境変数: `.env` / `.env.example` の `BRAVE_SEARCH_API_KEY`
- セットアップ: `setup/SETUP-FOR-CC.md` ステップ 2-B
