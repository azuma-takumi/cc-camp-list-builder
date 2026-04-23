# scraping-agent

Claude Code デスクトップアプリで動く汎用 Web スクレイピングエージェント。
ブートキャンプ受講生向けに配布する想定で、対話ベースでリサーチ要件を固めてから実行する。

結果は Google スプレッドシートに「1リサーチ = 1シート」で蓄積される。

---

## エントリーポイント(最重要)

ユーザーが「開始」「始める」「スタート」「使いたい」「何ができる?」等の
開始を意図するメッセージを送ってきたら、**まずセットアップ状態を自動チェック**する。

### 状態チェック手順

以下を **順番に** 確認する。**「必須」と「任意(推奨)」の区別が重要**:

1. `node_modules/` が存在するか(必須)
2. `.env` が存在し、以下を個別にチェック:
   - **【必須】** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`(Google OAuth)
   - **【必須】** `SPREADSHEET_ID`(Sheets 書き込み先)
   - **【任意・推奨】** `BRAVE_SEARCH_API_KEY`(search-based モード用。未設定なら search-based 使用時にエラー)
   - **【任意・推奨】** `GOOGLE_PLACES_API_KEY`(places モード+連絡先 Places フォールバック用。未設定なら places モード使用時にエラー)
3. `credentials/tokens.json` が存在するか(必須)

### チェック結果に応じた対応

判定は **3 段階** で行う:

- **A. 必須が 1 つでも欠けている** → セットアップに誘導(下記)
- **B. 必須は揃っているが任意が欠けている** → 「準備完了」メニューに "任意キーを追加する" 選択肢を表示
- **C. 必須・任意ともに揃っている** → フル機能の「準備完了」メニューを表示

#### A. 必須が NG の場合 → セットアップに誘導

```text
scraping-agent を使うには初期設定が必要です。
5〜10分ほどで完了します。一緒に進めましょう!

Brave Search API(検索エンジン経由のリサーチ用)と
Google Places API(店舗の電話番号取得用)は任意ですが、
揃えておくと全モード使えるようになります。どこまで設定するかは途中で選べます。
```

その後 `setup/SETUP-FOR-CC.md` を読み、**不足しているステップだけ** を実行する
(既に完了しているステップはスキップする)。

#### B. 必須のみ OK(任意が欠けている)の場合 → 拡張メニュー

```text
scraping-agent の準備ができています(必須設定 ✅)。

ただし、以下の任意キーが未設定です:
{未設定の任意キーを箇条書き}
  - Brave Search API が未設定 → search-based モード(検索経由のリサーチ)が使えません
  - Google Places API が未設定 → places モード(店舗の電話番号取得)・連絡先エンリッチの Places フォールバックが使えません

何をしますか?

1. リサーチする — list-detail / single モードだけなら今すぐ実行できます
2. 過去のリサーチを見る — これまでのリサーチシート一覧を表示します
3. 任意キーを追加する — Brave / Places を今設定します(推奨)

番号か、やりたいことを教えてください。
```

`3` を選ばれた場合は `.claude/skills/setup/SKILL.md` の **任意キー追加フロー** に入る
(Brave だけ / Places だけ / 両方 のどれをやるか選ばせる)。

#### C. 必須・任意ともに OK の場合 → フルメニュー

```text
scraping-agent の準備ができています!
何をしますか?

1. リサーチする — 対話しながら要件を固めて、スプシに結果を蓄積します
2. 過去のリサーチを見る — これまでのリサーチシート一覧を表示します
3. 連絡先を足す — 既存シートに電話番号・メールを後追加します(enrich-contact)
4. スケジュール / 保存済みスクリプトを見る — 定期実行や過去の保存を確認

番号か、やりたいことを教えてください。
```

---

## トリガー一覧

| ユーザーの発話 | エージェントの動作 |
|---|---|
| 「開始」「始める」「スタート」「使いたい」「何ができる?」 | 状態チェック → メニュー or セットアップ誘導 |
| 「セットアップして」「初期設定」 | `setup/SETUP-FOR-CC.md` を読んで手順に従う(Phase 4) |
| 「任意キー追加して」「Brave を追加」「Places を追加」「API キー足したい」 | `.claude/skills/setup/SKILL.md` の **任意キー追加フロー** を実行 |
| 「リサーチして」「スクレイピングして」「調べて」「○○のリスト作って」「営業先調べて」「案件探して」「競合調査して」 | `.claude/skills/research/SKILL.md` を読んで実行 |
| 「このリサーチをスクリプト化して」「よく使うから保存して」「スクリプトにして残して」 | `.claude/skills/save-as-script/SKILL.md` を読んで実行 |
| 「定期実行して」「毎朝実行して」「毎週月曜回して」「スケジュール登録」 | `.claude/skills/schedule/SKILL.md` を読んで実行 |
| 「一覧見せて」「履歴見せて」「スケジュール削除」「ログ見せて」「スクリプト消して」 | `.claude/skills/manage/SKILL.md` を読んで実行 |
| 「電話番号を足して」「連絡先を補完して」「このシートに電話・メール追加して」「エンリッチして」 | `tools/enrich-contact.mjs` を実行(後述の「連絡先エンリッチ」を参照) |
| 「○○サイトも取れるようにして」「○○ API 使いたい」「このツール拡張して」「新しいデータソース追加して」「Notion / Airtable に送りたい」 | `.claude/skills/extend-source/SKILL.md` を読んで実行 |
| research スキル実行中に「現状のツールでは対応不可」と判定された(公式API優先 / 認証必須 / 規約で NG 等) | `.claude/skills/extend-source/SKILL.md` に委譲する |

---

## 概要

- **対話重視**: いきなり実行せず、対象サイト・取得項目・件数を AI が提案ベースでヒアリング
- **4つのモード**: places(Google Maps API)/ list-detail / search-based / single
- **自動判定**: 静的HTML / JS描画 を自動判定して最適な方法で取得
- **礼儀正しい**: リクエスト間隔2秒±ジッター、robots.txt チェック、429自動リトライ、Cloudflare検知で即停止
- **1リサーチ=1シート**: シート名は `yyyyMMdd_<名前>` 自動生成
- **共通4列+固有列**: No. / タイトル / URL / 取得日時 + リサーチ固有項目

### モードの使い分け

| モード | 向いているケース | データソース |
|---|---|---|
| **places** | 飲食・美容・医療・小売の店舗リスト(**電話番号が確実に取れる**) | Google Places API (New) |
| list-detail | 特定サイトの一覧→詳細巡回(食べログ、クラウドワークス、Wantedly等) | Webスクレイピング |
| search-based | 「○○ ホームページ」等で Brave 検索→ヒット先を巡回 | Brave Search + Webスクレイピング |
| single | 数件の URL から情報取得(競合比較など) | Webスクレイピング |

**重要な指針**: 店舗型ビジネスの電話番号が欲しいときは **必ず places モードを最優先で提案する**。
公式サイトには電話番号が載っていないことが多いため、スクレイピングよりもはるかに効率的かつ合法。

### 連絡先エンリッチ(既存リストへの後追加)

BtoB 系の企業リスト(list-detail で取得した Baseconnect / Wantedly / OpenWork 等)には、
URL は取れても電話番号・メールが空のままのことが多い。この補完は `tools/enrich-contact.mjs` を使う:

1. URL 列を起点に **公式サイト → `/contact` / `/inquiry` / `/company` / `/about`** を順に巡回
2. `tel:` / `mailto:` リンクを最優先で抽出、見つからなければ本文から正規表現で補完
3. `--use-places` 指定時は、電話が取れなかった行に対して **Places API で「会社名+市区町村」検索** しフォールバック
4. シートに「電話番号(推定)」「メール(推定)」列を追加(既存の値は上書きしない安全設計)

**提案タイミング**:
- リサーチ完了後の Step 7 で「電話番号が空の行が目立つ」場合は、必ずこのエンリッチを選択肢として提示する
- ユーザーが「電話番号を足して」「連絡先を補完して」等と言ったら、このツールに直行する

### 自己拡張の方針(extend-source スキル)

このツールは配布時点で全サイト・全 API に対応することは不可能。
ユーザーが現状ツールでカバーできないサイト・サービスを使いたいと言った場合は、
`.claude/skills/extend-source/SKILL.md` に委譲して、その場で以下の流れで拡張する:

1. **調査** — 公式 API があるか Web 検索で確認(API 名・料金・認証方式・利用規約)
2. **報告** — 調査結果をユーザーに提示し、API 使用 / スクレイピング / 別サービス のどれで進めるか決める
3. **API キー発行案内** — 必要な場合、**ステップバイステップ**で画面上の位置も含めて案内(スクショは使えないので「左上のハンバーガーメニューから...」レベルで丁寧に)
4. **`.env` / `.env.example` 更新** — キー名・コメントを両方に追加
5. **コネクタ実装** — `tools/lib/<name>.mjs` を追加(`google-places.mjs` / `brave-search.mjs` がお手本)
6. **研究 / エンリッチへの統合** — research.mjs にモード追加 or 既存モードで対応
7. **ドキュメント化** — `docs/integrations/<name>.md` に発行手順・料金・制約を記録(次回再現できるように)
8. **配布物への反映判断** — 受講生配布に含めるかをユーザーに確認し、README / CLAUDE.md / setup を更新

**絶対に守るべき原則**:
- 公式 API を必ず最初に探す(合法性・安定性・速度で優位)
- 料金は発行前にユーザーに伝える(無料枠・有料条件・月額目安)
- 利用規約は必ず確認してユーザーに報告
- スクショは使えないので、UI の場所を**言葉で**丁寧に説明する

---

## スプレッドシート構成

SSOT: Google スプレッドシート(テンプレート作成方式)

### リサーチシート(毎回新規作成 / 既存への追記も可)

| 列 | 内容 | 埋める主体 |
|----|------|---------|
| A: No. | 連番 | 自動 |
| B: タイトル | 会社名・案件名・競合名など | AI |
| C: URL | 詳細ページのリンク | AI |
| D: 取得日時 | yyyy/MM/dd HH:mm:ss | 自動 |
| E以降 | リサーチ固有の項目(業種・報酬・住所など) | AI |

シート名の形式: `yyyyMMdd_<名前>` (例: `20260420_新宿居酒屋`)

---

## スクレイピングの礼儀設定(デフォルト)

- **リクエスト間隔**: 2秒 ± 1秒ジッター
- **並列数**: 1(直列)
- **件数上限**: 50件
- **User-Agent**: 通常のChromeブラウザ UA
- **robots.txt**: 実行前に自動チェック、禁止なら警告してユーザーに確認
- **エラー時挙動**:
  - HTTP 429 / 503: 自動リトライ(`Retry-After` 尊重、最大5分)
  - HTTP 403: 即停止 + ユーザーに報告
  - Cloudflare / Captcha 検知: 即停止 + 「手動取得推奨」と報告
  - 3回連続失敗: 自動停止

サイトごとの"安全な間隔"を `.scrape-profiles/` に蓄積し、2回目以降に自動適用。

---

## コマンド一覧

| コマンド | 用途 |
|---|---|
| `node auth-google.mjs` | Google OAuth 認証(ブラウザが開く) |
| `node tools/init-spreadsheet.mjs` | スプシ接続テスト(`--id` で SPREADSHEET_ID を .env に保存) |
| `node tools/create-template-sheet.mjs` | 空のスプシを新規作成 |
| `node tools/research.mjs --config <path>` | 設定駆動のリサーチ実行 |
| `node tools/research-helpers.mjs <subcommand>` | 補助コマンド群(スキルから呼ばれる) |
| `node tools/save-as-script.mjs --name <名前>` | config を scrapers/<名前>.mjs に保存(stdin に JSON) |
| `node tools/run-scraper.mjs <名前> [--dry-run]` | 保存済みスクリプトを実行 |
| `node tools/run-scraper.mjs --list` | 保存済みスクリプト一覧 |
| `node tools/schedule.mjs --name <名前> --daily HH:MM` | 定期実行登録(launchd) |
| `node tools/schedule.mjs --name <名前> --remove` | 定期実行削除 |
| `node tools/list-schedules.mjs` | 登録済みスケジュール一覧(人間向け整形) |
| `node tools/enrich-contact.mjs --sheet <シート名>` | 既存シートに電話番号・メールを後追加 |

### enrich-contact のオプション

| フラグ | 例 | 意味 |
|---|---|---|
| `--sheet <名前>` | `--sheet 20260420_東京_製造業` | 対象シート名(必須) |
| `--url-column <列名>` | `--url-column 公式サイト` | URL 列の見出し名(既定: `公式サイト`) |
| `--name-column <列名>` | `--name-column タイトル` | 会社名列の見出し名(既定: `タイトル`。Places フォールバックで使用) |
| `--address-column <列名>` | `--address-column 住所` | 住所列の見出し名(既定: `住所`。Places フォールバックで精度向上に使用) |
| `--use-places` | — | スクレイピングで電話が取れなかった行に Places API でフォールバックする |
| `--places-only` | — | スクレイピングを完全にスキップし、Places API のみで補完する |
| `--max N` | `--max 5` | 先頭 N 行だけ処理(動作確認用) |

### research-helpers サブコマンド

| サブコマンド | 用途 |
|---|---|
| `create-sheet --name <名前> [--columns "a,b,c"]` | リサーチシート新規作成 |
| `inspect-page --url <URL> [--selectors ".a,.b"]` | 1ページを取得して構造レポートを出す(取得可能性チェック) |
| `search --query <q> [--max 20]` | Brave Search で検索 |
| `append-rows --sheet <シート名>` | stdin JSON 配列でシートに行追加 |
| `list-sheets` | 既存のリサーチシート一覧 |

### schedule のスケジュール指定

| フラグ | 例 | 意味 |
|---|---|---|
| `--daily HH:MM` | `--daily 09:00` | 毎日 HH:MM |
| `--weekly <曜日>=HH:MM` | `--weekly mon=09:00` | 毎週<曜日>HH:MM(sun〜sat) |
| `--every-hours N` | `--every-hours 6` | N時間ごと(小数可) |
| `--interval-sec N` | `--interval-sec 300` | N秒ごと(デバッグ用) |
| `--remove` | — | 登録解除 |
| `--dry-run` | — | plistの内容だけ出力、書き込みなし |
| `--force` | — | 既存登録を上書き |
| `--list` | — | 登録済みをJSONで出力 |

---

## ディレクトリ構成

ユーザー向けドキュメントは `README.md` 参照。

```
scraping-agent/
├── CLAUDE.md                      # このファイル(エージェント用の全体指示書)
├── README.md                      # ユーザー向けドキュメント
├── package.json
├── .env                           # APIキー(git管理外)
├── .env.example
├── auth-google.mjs                # Google OAuth(ブラウザ)
├── setup/
│   └── SETUP-FOR-CC.md            # エージェント駆動セットアップ手順書
├── tools/
│   ├── lib/
│   │   ├── sheets.mjs             # Sheets API ヘルパー
│   │   ├── fetch.mjs              # 静的HTML 取得 (cheerio)
│   │   ├── browser.mjs            # Puppeteer ヘルパー (JS描画)
│   │   ├── scraper.mjs            # 自動判定+統合スクレイパー
│   │   ├── throttle.mjs           # レート制限+リトライ+エラー検知
│   │   ├── robots.mjs             # robots.txt チェック
│   │   ├── brave-search.mjs       # Brave Search API
│   │   ├── google-places.mjs      # Google Places API (New)
│   │   └── scrape-profiles.mjs    # サイト別"安全間隔"の記憶
│   ├── init-spreadsheet.mjs       # スプシ接続テスト
│   ├── create-template-sheet.mjs  # 空スプシ新規作成
│   ├── research.mjs               # 設定駆動のリサーチ実行エンジン
│   ├── research-helpers.mjs       # エージェントが呼ぶ補助コマンド群
│   ├── enrich-contact.mjs         # 既存シートに電話番号・メールを後追加(scrape + Places)
│   ├── save-as-script.mjs         # config を scrapers/<名前>.mjs に保存
│   ├── run-scraper.mjs            # 保存済みスクリプトを名前で実行
│   ├── schedule.mjs               # launchd スケジュール登録/削除
│   └── list-schedules.mjs         # 登録済みスケジュール一覧(人間向け)
├── scrapers/
│   ├── _template.mjs              # config 設定例(3モード分)
│   └── <名前>.mjs                 # save-as-script で保存された実行可能スクリプト
├── .scrape-profiles/              # サイト別設定(git管理外)
├── .claude/skills/
│   ├── setup/SKILL.md             # 初期セットアップ対話手順書
│   ├── research/SKILL.md          # リサーチ対話手順書
│   ├── save-as-script/SKILL.md    # スクリプト化対話手順書
│   ├── schedule/SKILL.md          # 定期実行登録対話手順書
│   ├── manage/SKILL.md            # 管理(一覧/削除/ログ)対話手順書
│   └── extend-source/SKILL.md     # 新サイト・API への拡張対話手順書
├── .cursor/skills/                # 同上(Cursor用ミラー)
├── docs/
│   └── integrations/              # 各コネクタの発行手順・料金・制約メモ
│       ├── _template.md           #  - 新規コネクタ作成時のテンプレ
│       ├── google-places.md       #  - Google Places API
│       └── brave-search.md        #  - Brave Search API
└── credentials/tokens.json        # Google OAuth トークン(git管理外)

# 外部に作成されるファイル(launchd 関連)
~/Library/LaunchAgents/local.scraping-agent.<名前>.plist  # launchd 設定(プレフィックスは .env の LAUNCHD_LABEL_PREFIX で変更可)
~/Library/Logs/scraping-agent/<名前>.log / <名前>.err.log        # 定期実行ログ
```

---

## 技術スタック

- Node.js (ESM)
- `googleapis` — Sheets API v4 + Drive API v3
- `puppeteer` — JS描画ページの取得
- `cheerio` — HTML パース
- `@anthropic-ai/sdk` — Claude API(必要に応じて使う)
- Brave Search API — 検索エンジン経由のリサーチ
- Google Places API (New) — 店舗型ビジネスの電話番号・住所・営業時間取得

---

## 実装フェーズ(開発進捗)

- **Phase 1**: 基盤ライブラリ(完了)
  - Google OAuth / Sheets ヘルパー / fetch / puppeteer / throttle / robots / brave-search / profiles / init/create-template
- **Phase 2**: リサーチ実行エンジン + research スキル(完了)
  - `tools/research.mjs`(3モード: single / list-detail / search-based)
  - `tools/research-helpers.mjs`(create-sheet / inspect-page / search / append-rows / list-sheets)
  - `.claude/skills/research/SKILL.md`(対話フロー: ヒアリング → 取得可能性チェック → 最終確認 → 実行 → 結果報告)
- **Phase 3**: スクリプト化 + 定期実行 + 管理スキル(完了)
  - `tools/save-as-script.mjs` / `run-scraper.mjs` / `schedule.mjs` / `list-schedules.mjs`
  - `.claude/skills/save-as-script/SKILL.md`
  - `.claude/skills/schedule/SKILL.md`(launchd、毎日/毎週/N時間ごとに対応)
  - `.claude/skills/manage/SKILL.md`(一覧/削除/ログ確認)
- **Phase 4**: セットアップスキル + ドキュメント(完了)
  - `setup/SETUP-FOR-CC.md`(OAuth + Brave API 取得のステップ込み)
  - `.claude/skills/setup/SKILL.md`(状態チェック → 不足分だけ案内)
  - `README.md`(受講生向けの使い方ガイド)
  - `.env.example` にセクション別コメントを整備
- **Phase 5**: Google Places API 連携(完了)
  - `tools/lib/google-places.mjs`(Text Search + ページネーション、フィールド正規化)
  - `tools/research.mjs` に `mode: "places"` 追加
  - `scrapers/_template.mjs` に samplePlaces 追加
  - `setup/SETUP-FOR-CC.md` にステップ 2-C(Places API 有効化+Billing)を追加
  - `research/SKILL.md` に places モードのフロー追加(Step 2 で最優先提案、Step 3-P、Step 4 スキップ)
  - `.env.example` に `GOOGLE_PLACES_API_KEY` 追加
- **Phase 6**: 連絡先エンリッチ(完了)
  - `tools/enrich-contact.mjs`(既存シートに電話番号・メールを後追加)
  - 公式サイト巡回(`tel:` / `mailto:` 優先 → 本文正規表現 → `/contact` 等のセカンダリパス)
  - Places API フォールバック(`--use-places` / `--places-only`)
  - 会社名の正規化(㈱・株式会社を除去して比較)、住所の市区町村レベルでマッチング
  - 既存の値は上書きしない(空のときだけ補完)
  - `research/SKILL.md` の Step 7 にエンリッチ提案フロー追加
- **Phase 7**: UX 強化 & 自己拡張(完了)
  - `research/SKILL.md` の Step 5(最終確認)を「スプシの列構成をテーブル形式で見せる」形に強化
    - 列の追加/削除/順序変更/見出し名変更まで選択肢として提供
    - places モード(固定列)でも列テーブルを必ず提示
  - `.claude/skills/extend-source/SKILL.md` を新設(+ `.cursor` にミラー)
    - 公式 API / スクレイピング / 認証必須 / 外部連携 の4パターンに対応
    - API キー発行をステップバイステップで案内
    - `.env` / `.env.example` 両方を更新、コネクタ実装、ドキュメント化の全体フロー
    - 配布物への反映判断をユーザーに確認するフェーズも含む
  - `docs/integrations/` ディレクトリを新設(`_template.md` / `google-places.md` / `brave-search.md`)
  - research スキルから extend-source への委譲条件を明文化
