# 自作-リスト作成(水、化粧品、サプリ)

化粧品、サプリメント、ウォーターサーバー領域の営業リストを収集し、Google スプレッドシートへ整理するための案件フォルダです。

## 目的

- TVショッピング
- 自社通販
- Yahoo
- 楽天

これら複数ソースから営業候補を集め、重複整理や問い合わせ先補正まで含めてシートを整えることを目的にしています。

## 主なスクリプト

- `main.mjs`
  - 全体実行の入口
- `dedupe-sheets-by-brand-priority.mjs`
  - シート横断の重複整理
- `fix-yahoo-talk-urls.mjs`
  - Yahoo 問い合わせURLの正規化
- `fix-contacts.mjs`
  - 個別の連絡先補正
- `cleanup.mjs`
  - 非関連行の削除

## よく使うコマンド

```bash
npm install
npm run collect
npm run dedupe
npm run check:yahoo-links
npm run fix:yahoo-talk
```

## 関連メモ

- この案件の改善ログ: `IMPROVEMENTS.md`
- 横断の学び一覧: `/Users/user/addness/CROSS-PROJECT-LEARNINGS.md`
- 共通テンプレ: `/Users/user/addness/IMPROVEMENT-TEMPLATE.md`

## 補足

- このフォルダは現時点では Git 管理外
- 長時間処理や削除系スクリプトがあるため、反映前に範囲限定や dry-run 相当の確認を挟むのが安全
