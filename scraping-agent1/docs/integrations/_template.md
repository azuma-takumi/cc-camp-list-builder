# <サービス名> 連携メモ

> 新しいコネクタを作ったら、このテンプレをコピーして `docs/integrations/<name>.md` として保存する。
> 次に同じサービスを使うとき(or 受講生が見たとき)に再現できる情報をすべて残す。

---

## 概要

- **サービス名**: <正式名称>
- **用途**: <このツールで何を取る / 何に使うのか>
- **公式サイト**: <URL>
- **公式ドキュメント**: <URL>
- **API 名**: <例: Places API (New), Hotpepper Gourmet API v1.3>
- **追加日**: YYYY-MM-DD
- **コネクタファイル**: `tools/lib/<name>.mjs`

## 料金

- **無料枠**: <例: 月 50,000 リクエストまで無料>
- **課金条件**: <例: 無料枠を超えると 1,000 req あたり $10>
- **クレジットカード登録**: <必須 / 不要>
- **想定月額(ブートキャンプ受講生の使い方)**: <例: 月 数百円 程度>
- **予算アラートの設定方法**: <例: Google Cloud Console → お支払い → 予算とアラート>

## コネクタへの料金登録(PRICING_META)

`tools/lib/<name>.mjs` のモジュールロード時に `registerApi()` で登録する。
この値を元に、リサーチ結果の 💰 ブロック(セッション費用 + 今月累計)が自動生成される。

```javascript
import { registerApi, trackRequest } from "./usage.mjs";

registerApi("<name>", {
  label: "<表示名>",
  // "per-request" | "free-tier-quota" | "free" のいずれか
  priceModel: "per-request",
  // per-request 時: USD 単価
  pricePerRequest: 0.01,
  currency: "USD",
  freeTier: {
    description: "<例: 月 N 回無料>",
    limit: 2000,        // 数量ベースの無料枠(free-tier-quota 用)
    limitUsd: 200,      // 金額ベースの無料枠(Google Cloud 等)
  },
  dashboardUrl: "<実請求を確認できる URL>",
  note: "<補足メッセージ(任意)>",
});
```

さらに、各リクエスト送信の **直後(エラー判定の前)** に `trackRequest("<name>")` を呼ぶ。
HTTP エラー応答でも API 呼び出しは課金対象になる場合があるため、ステータスに関わらずカウントする。

## 認証方式

- <例: API Key(ヘッダーに `X-Api-Key`)、OAuth2、Bearer Token、HMAC 署名>
- `.env` のキー名: `<SERVICE>_API_KEY`(複数ある場合は列挙)

## API キーの発行手順

(`extend-source` スキルの A-2 で案内した内容をそのままコピペ)

### ステップ 1. アカウント作成 / ログイン

1. ブラウザで <URL> を開く
2. <具体的なボタンの位置>
3. ...

### ステップ 2. API キー発行

1. ...
2. ...

### ステップ 3. 有効化 / 権限付与(必要な場合)

1. ...

### ステップ 4. 料金制限の設定(任意だが推奨)

1. ...

### ステップ 5. `.env` に貼り付け

```env
<SERVICE>_API_KEY=<ここに貼り付け>
```

## 取得できる主なフィールド

| フィールド | 型 | 例 |
|---|---|---|
| `id` | string | `ChIJN1t_...` |
| `name` | string | `〇〇店` |
| `address` | string | `東京都新宿区...` |
| `phone` | string | `03-1234-5678` |
| `website` | string(URL) | `https://...` |
| ... | | |

## レート制限

- **1秒あたり**: <例: 最大 10 QPS>
- **1日あたり**: <例: 10,000 req>
- **同時接続**: <例: 並列化可能(ただし礼儀として MIN_INTERVAL_MS を設定)>

## 動作確認済みの使用例

### 使用例 1: <目的>

```bash
# どんなクエリでどんな結果が返るか、の再現コマンド
echo '{
  "name": "test",
  "mode": "<mode>",
  "query": "<クエリ>"
}' | node tools/research.mjs --config - --dry-run
```

結果の一部:
```json
{ "name": "...", "phone": "..." }
```

## 規約・利用制約

- **再配布**: <例: 禁止 / 社内利用に限り可 / オープンデータ>
- **データ保持期間**: <例: 30 日以内>
- **二次利用**: <例: 可 / 要クレジット表示>
- **他に重要な制約**: <例: Google Maps 表示とセットで使うこと>

## 既知の注意点 / 落とし穴

- <例: 日本の都道府県名が欠落しているレスポンスがある>
- <例: 同名の別店舗が複数返ることがある → マッチング時に住所で確認必要>
- <例: 一部業種で電話番号が返らない(医療機関など)>

## 関連ファイル

- コネクタ: `tools/lib/<name>.mjs`
- サンプル config: `scrapers/_template.mjs` の `sample<Name>` セクション
- 環境変数: `.env` / `.env.example`
- セットアップ: `setup/SETUP-FOR-CC.md`(受講生配布に含めた場合のみ)
