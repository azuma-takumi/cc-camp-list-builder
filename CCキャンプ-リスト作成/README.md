# CCキャンプ-リスト作成

クラウドワークスなどで受けた営業リスト作成案件向けに、共有されたスプレッドシートを読み取り、依頼文を整理し、URL列の問題を自動検査するツールです。

この版は `チャット中心` で使う前提です。あなたは `スプレッドシートURL` と `依頼文` を渡します。システム側が列構成の確認と URL チェックを行い、問題がないときは静かに進み、問題が残るときだけログ付きで知らせます。

## GitHub

- リポジトリ: `https://github.com/azuma-takumi/cc-camp-list-builder.git`
- Git の確認メモ: `GIT-GUIDE.md`
- この案件の改善ログ: `IMPROVEMENTS.md`
- 横断の学び一覧: `/Users/user/addness/CROSS-PROJECT-LEARNINGS.md`

## できること

- スプレッドシートURLから対象シートを読む
- 依頼文から検索元や必要項目のヒントを整理する
- URL列を自動判定して確認する
- `https` 補完や `http` 再試行などの軽い自動修正を試す
- 直せなかったURLだけログに残す

## まだやっていないこと

- 企業候補の自動収集
- 外部APIを使った企業情報取得
- 問い合わせフォームURLの自動発見
- 案件ごとの列に応じた完全自動入力

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

- 実行サマリー: `logs/latest-run-summary.md`
- エラーログ: `logs/run-YYYY-MM-DD.log`

URLチェックで問題がなければ、特別な通知は出しません。問題が残ったものだけ、行番号とログが出ます。

## Git の最小運用

状態確認:

```bash
git status
```

変更を GitHub に反映:

```bash
git add .
git commit -m "更新内容"
git push
```

詳しい見方や `??` `!!` の意味は `GIT-GUIDE.md` を参照してください。
