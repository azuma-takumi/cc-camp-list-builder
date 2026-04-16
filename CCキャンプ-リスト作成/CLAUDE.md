# CCキャンプ-リスト作成

クラウドワークスなどで受けた営業リスト作成案件向けの、自動化プロジェクトです。

共有されたスプレッドシートURLと依頼文を受け取り、まずは以下を自動で行います。

- シート構造の確認
- 依頼文の整理
- URL列の自動チェック
- 軽い自動修正の試行
- 直せなかった問題だけの報告

## コマンド一覧

```bash
npm install
node auth-google.mjs
node tools/init-spreadsheet.mjs --id YOUR_SPREADSHEET_ID
node tools/run-sales-list.mjs --sheet "SHEET_URL_OR_ID" --request "依頼文"
```

## プロジェクト構成

```text
CCキャンプ-リスト作成/
├── CLAUDE.md
├── README.md
├── package.json
├── .env.example
├── auth-google.mjs
├── setup/
│   └── SETUP-FOR-CC.md
├── tools/
│   ├── init-spreadsheet.mjs
│   ├── run-sales-list.mjs
│   └── lib/
│       ├── sheets.mjs
│       ├── request-parser.mjs
│       └── url-checker.mjs
├── logs/
│   ├── latest-run-summary.md
│   └── run-YYYY-MM-DD.log
└── .cursor/skills/build-project/
    └── SKILL.md
```

## 共通ルール

- ユーザーとのやり取りは日本語で行う
- できるだけチャット中心で進める
- 正常な URL は通知しない
- 問題が起きたときは自動で改善方法を試す
- それでも直らないときだけ、実行ログ付きでユーザーに伝える

## 想定ワークフロー

1. ユーザーが案件の依頼文とスプレッドシートURLを渡す
2. システムが対象シートを読み取る
3. システムが依頼文から検索条件や除外条件のヒントを整理する
4. URL列があれば自動チェックする
5. `https` 補完や `http` 再試行で直るものは自動修正する
6. 問題が残るものだけログに残して報告する

## 現在の実装範囲

### できること

- スプレッドシートURLまたはIDの受け取り
- シートのヘッダー読み取り
- 依頼文の簡易解析
- URL列の自動判定
- URLの通信確認
- 軽い自動修正
- 実行サマリー作成

### まだ未実装

- 外部APIを使った営業先候補の自動収集
- 企業情報の本格取得
- 問い合わせフォームURL探索
- 行の自動追加
- 案件別テンプレート切り替え

## エラー時の扱い

- 接続や認証の問題は、その内容を短く説明する
- URLが直らない場合だけ `logs/` の内容を元に報告する
- 正常終了時は、最低限のサマリーだけを出す
