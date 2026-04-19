# CCキャンプ-リスト作成

クラウドワークスなどで受けた営業リスト作成案件向けに、共有されたスプレッドシートを読み取り、依頼文を整理し、URL列の問題を自動検査するツール群です。

この版は `チャット中心` で使う前提です。`run-sales-list` では `スプレッドシートURL` と `依頼文` を渡します。システム側が列構成の確認と URL チェックを行い、問題がないときは静かに進み、問題が残るときだけログ付きで知らせます。

別フローでは、YouTube や Web 検索・サイト巡回で **候補企業・連絡先（メール等）を探索しシートへ書き込む** スクリプトもあります（対象シートやクエリは案件ごとにスクリプト側で定義されていることが多いです）。

## GitHub

- リポジトリ（モノレポのルート）: `https://github.com/azuma-takumi/cc-camp-list-builder.git`
- Git の確認メモ: `GIT-GUIDE.md`（コマンドはリポジトリルート `/Users/user/addness/cursor/list-builder` で実行）
- この案件の改善ログ: `IMPROVEMENTS.md`
- 横断の学び一覧: `/Users/user/addness/cursor/list-builder/CROSS-PROJECT-LEARNINGS.md`
- 改善ログ共通テンプレ: `/Users/user/addness/cursor/list-builder/IMPROVEMENT-TEMPLATE.md`

## できること

### `tools/run-sales-list.mjs`（メインの対話フロー）

- スプレッドシート URL または ID から対象シートを読む
- 依頼文から検索の切り口や必要項目のヒントを整理する（要約）
- 見出し行から URL らしい列を自動判定し、セル単位で到達確認する
- `https` 補完や `http` 再試行などの軽い自動修正を試す
- 直せなかった URL だけログに残し、実行サマリーを `logs/` に出す

### YouTube・連絡先探索・シート更新系（案件用スクリプト）

次のような処理が **コードとして実装済み** です（利用するには API キーや `.env`、対象スプレッドシート ID の設定が必要なものがあります）。

- YouTube チャンネル検索・URL 正規化、チャンネル指標の取得（YouTube Data API）
- Google / Brave 等を使った Web 検索（`discover-youtube-sales-leads.mjs` など）
- 公式サイト周辺ページの巡回で **メール・会社名・代表者名** を探す（`lib/contact-discovery.mjs`、特商法・問い合わせ導線の優先）
- Firecrawl 経由の取得（設定時）
- 既存行の URL 修復・CrowdWorks 用の行修復、メトリクス埋めなどの専用スクリプト（`tools/` 配下）

### npm スクリプト

- `npm run auth` … Google OAuth（`auth-google.mjs`）
- `npm run init` … スプレッドシート接続確認（`tools/init-spreadsheet.mjs`）
- `npm run run` … `run-sales-list` の省略形

その他のバッチは `node tools/<スクリプト名>.mjs` で実行します。一覧は `tools/` ディレクトリを参照してください。

## 限界・汎用ではないこと

次は **「このリポジトリ全体としてまだ持っていない／案件によっては手作業や別設計が必要」** という意味です。

- **依頼文だけから、業界横断で無限に企業候補を生成する汎用エンジン**ではない。候補探索は YouTube 探索スクリプト等で行うが、検索クエリ・対象シート・行ルールは案件ごとにコードや定数に寄せている
- **`run-sales-list` 単体**は、主に **既存シートの URL 列チェックと依頼文の整理**が中心。行の大量新規追加や、全列の意味推論による一括入力は別スクリプトの役割
- **問い合わせフォーム URL** は、巡回・抽出で取れる場合があるが、サイト構造によっては取りこぼす。メール取得の方が実装・運用実績が厚い（`IMPROVEMENTS.md` 参照）
- **列レイアウトが毎回まちまちの案件**に対して、設定なしで「すべての列を自動マッピング」する仕組みはない。シートごとに列定数や専用スクリプトがある

## セットアップ

1. 依存関係を入れる

```bash
npm install
```

2. `.env.example` を元に `.env` を用意して、Google OAuth の値を入れる

3. Google 認証を行う

```bash
node auth-google.mjs
```

4. 共有されたスプレッドシートで接続確認する

```bash
node tools/init-spreadsheet.mjs --id YOUR_SPREADSHEET_ID
```

## 実行方法

```bash
node tools/run-sales-list.mjs \
  --sheet "https://docs.google.com/spreadsheets/d/xxxxx/edit#gid=0" \
  --request "東京都のWeb制作会社。除外ワード: 個人事業主。会社名、URL、問い合わせフォームURLが必要"
```

必要ならシート名も指定できます。

```bash
node tools/run-sales-list.mjs \
  --sheet "YOUR_SPREADSHEET_ID" \
  --tab "営業リスト" \
  --request "大阪のSaaS企業を対象。URLと住所を確認"
```

## 出力

- 実行サマリー（`run-sales-list`）: `logs/latest-run-summary.md`
- 日付付きログ: `logs/run-YYYY-MM-DD.log`
- その他スクリプトは `logs/` に用途別のサマリーやログを出すことがあります（`tools/lib/summary-writer.mjs` ベースで形式を揃えています）

`run-sales-list` で URL チェックに問題がなければ、特別な通知は出しません。問題が残ったものだけ、行番号とログが出ます。

## Git の最小運用

このフォルダは **Git リポジトリのルートではありません**。リポジトリのルートは **`list-builder`**（ひとつ上のディレクトリ）です。

状態確認:

```bash
cd "/Users/user/addness/cursor/list-builder"
git status
```

変更を GitHub に反映:

```bash
cd "/Users/user/addness/cursor/list-builder"
git add .
git commit -m "更新内容"
git push
```

詳しい見方や `??` `!!` の意味は `GIT-GUIDE.md` を参照してください。
