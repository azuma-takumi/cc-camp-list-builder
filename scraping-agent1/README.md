# scraping-agent

Web スクレイピングで「営業先リスト」「案件探索」「競合調査」などのリサーチを自動化するツール。

Claude Code(または Cursor Agent)と対話しながら、**取得先 / 取得項目 / 件数** を決めて実行し、
結果を Google スプレッドシートに自動で蓄積する。

ブートキャンプ受講生向けに配布する想定で設計されている。

---

## できること

- **AI対話でリサーチ設計** — 「新宿の居酒屋リスト作りたい」と言うだけで、取得項目や件数を対話で確定
- **4つのリサーチモード**
  - `places` — **Google Places API 経由で店舗の電話番号・住所・営業時間を一発取得**(飲食・美容・医療・小売向け)★イチオシ★
  - `list-detail` — 一覧ページから詳細URLを抽出 → 各ページ巡回(食べログ、クラウドワークス、Wantedly 等)
  - `search-based` — Brave で検索 → ヒット先を自動巡回(「○○ ホームページ」で営業先を集めるパターン)
  - `single` — URL を指定して情報を取る(競合数社の製品ページ等)
- **連絡先エンリッチ** — 既存リスト(URL列あり)に対して、公式サイト巡回 + Places API フォールバックで電話番号・メールを後追加
- **自動判定** — 静的HTML / JS描画を自動で判別、最適な方法で取得
- **取得可能性チェック** — 実行前に1ページだけ見に行って、欲しい情報が取れるか確認
- **スプシの列を事前確認** — 実行前に「このスプレッドシートにこういう列で集めますよ」と表で見せて確認をとる
- **礼儀正しい** — robots.txt チェック、間隔2秒+ジッター、リトライ、Cloudflare検知で即停止
- **スクリプト化** — よく使うリサーチを `scrapers/<名前>.mjs` として保存し、2回目以降は即実行
- **定期実行** — macOS launchd で「毎朝9時」「毎週月曜」などに自動リサーチ
- **自己拡張** — 対応したいサイト・サービスを伝えれば、AI が公式 API を調査し、必要なキーの発行手順を案内してツールを拡張してくれる

---

## 必要なもの

**必須**:

- macOS(launchd による定期実行のため)
- [Claude Code Desktop](https://docs.claude.com/en/docs/claude-code/getting-started) または Cursor Agent
- Node.js 20 以上(`node -v` で確認)
- Google アカウント(Sheets / Drive へのアクセス用)

**任意(推奨)** — 揃えておくと全モード使えるようになります:

- Brave Search API 無料アカウント — 月2000クエリ無料。`search-based` モード(検索経由のリサーチ)に使う
- Google Maps Platform(Places API)アカウント — Maps Platform の月 $200 無料クレジット内で運用可能(目安: 数千件/月は無料)。`places` モード(店舗の電話番号取得)と連絡先エンリッチの Places フォールバックに使う

どちらも使わなくても `list-detail` / `single` モードは動くが、実用上はどちらかは設定しておくのをおすすめします。

---

## はじめかた(5〜10分)

### 1. Claude Code でこのフォルダを開く

Claude Code Desktop を起動 → 「フォルダを開く」でこのディレクトリを選ぶ。

### 2. 「セットアップして」と言う

チャットに以下のどれかを入力するだけ:

- `セットアップして`
- `初期設定`
- `始めたい`
- `使いたい`

AI が `setup/SETUP-FOR-CC.md` を読んで、一緒にステップを進めてくれる。
冒頭で進め方を3つから選べる:

- **全部まとめてセットアップする**(必須 + 任意 Brave / Places も一緒、推奨)
- **必須だけ先にセットアップする**(任意は後で追加)
- **不足分だけ自動で進める**(既に揃っているものはスキップ)

実際のステップ:

**必須**
1. 依存パッケージのインストール(`npm install`)
2. Google OAuth クライアントの発行(画面を見ながら一緒に設定)
3. Google 認証(ブラウザが開く)
4. 空のスプレッドシートの自動作成

**任意(推奨)**
5. Brave Search API キーの取得(無料プラン)
6. Google Places API キーの取得(Maps Platform 無料クレジット内で運用)

任意の2つは、使う予定がなければ今スキップしても後から追加できます
(あとから「任意キーを追加して」と言えば再開できる)。

**ファイルは直接触らなくていい**。値の貼り付けと「できた」と伝えるだけで進む。

---

## 使い方の例

### 例1. 営業先リストを作る(店舗型 = Google Maps から一発取得)

チャットに:

```
新宿の居酒屋の営業先リスト作って(電話番号付き)
```

AI が対話で以下を確認してくる(**ユーザーは番号で答えるだけ**):

1. どのサイトから取る? → **1. Google Maps から取る** を推奨される
2. 検索クエリを確認(例: `新宿区 居酒屋`)
3. 絞り込み条件(今営業中のみ / 評価 3.5 以上 / 特になし)
4. 件数上限(デフォルト 50、最大 60)
5. 最終確認 → 1 (このまま実行) を選ぶ

実行後、スプシに `20260420_新宿_居酒屋` シートが作られ、以下9列が入る:

- 店名 / 住所 / 電話番号 / 公式サイト / 評価 / レビュー数 / 営業時間 / Google Maps URL / 営業状態

**Web スクレイピングでは取りづらい電話番号が、合法的にサクッと取れるのがポイント**。

### 例2. 案件を継続的に探す

```
クラウドワークスでReact関連の案件を毎朝9時に自動で取ってきて
```

1. リサーチが完了
2. 「スクリプト化する?」と聞かれるので 1 (する)
3. 「定期実行セットする?」と聞かれるので 1 (する)
4. 「何時?」→ `9:00`
5. 完了。翌朝9時から毎日自動実行される

### 例3. 競合3社の製品ページを比較する

```
競合A・B・C社の製品ページから、価格と特徴を比べたい
```

AI が URL を聞いてきて、ページ1つを事前チェックし、取得可能な項目を提示 → 実行 → スプシに並んだ形で比較できる状態に。

### 例5. 新しいサイト・サービスに対応する(ツール自体を拡張する)

最初から全サイトに対応するのは不可能なので、「このサイト取りたい / この API 使いたい」と言えば
AI が調査してツール自体を拡張してくれる。

```
ホットペッパーグルメからも取れるようにしたい
```

```
Notion にも同時に送りたい
```

```
Indeed の求人取得できるようにして
```

AI の動き:

1. 公式 API があるか調査(利用規約・料金・認証方式を確認)
2. 料金と使用感をユーザーに報告(「月 2,000 件までなら無料です」など)
3. API キー発行手順をステップバイステップで案内(画面の位置も言葉で)
4. 発行されたキーを `.env` に追加(`.env.example` にもコメント付きで追加)
5. コネクタ(`tools/lib/<name>.mjs`)を新規作成
6. `tools/research.mjs` にモードを追加 or 既存モードで対応
7. 少量テストで動作確認
8. `docs/integrations/<name>.md` に発行手順・料金・制約を記録(次回再現できるように)
9. 受講生配布物に含めるか、自分用だけに留めるかを確認

公式 API がない場合は、利用規約と robots.txt を確認したうえで、スクレイピングでの対応を検討する
(Cloudflare・CAPTCHA のサイトは突破せず、別手段を提案)。

認証(ログイン)が必要なサイトは、ブラウザで手動ログイン → Cookie エクスポート → ツールに取り込む
半自動方式を案内する。

### 例4. 既存リストに電話番号・メールを後から足す(BtoB 向け)

BtoB 企業のリストは公式サイトに電話番号が載っていないことが多く、1件ずつ調べるのは大変。
取得済みのシートに対して、公式サイトを巡回し、見つからなければ Google Places で検索、という多段で補完できる。

```
20260420_東京_製造業 のシートに電話番号を足したい
```

挙動:

1. URL 列(デフォルト `公式サイト`)を起点に、各社のトップページを取得
2. `tel:` / `mailto:` リンクを最優先で採用
3. 見つからなければ `/contact` `/inquiry` `/company` `/about` を順に試す
4. それでも電話番号が空なら、「会社名 + 住所(市区町村まで)」で Google Places を検索しフォールバック
5. 「電話番号(推定)」「メール(推定)」列を追加してシートに反映(既存の値は上書きしない)

直接コマンドで叩く場合:

```bash
# スクレイピングのみ(既定)
node tools/enrich-contact.mjs --sheet <シート名> --url-column 公式サイト

# スクレイピング → 見つからなければ Places API でフォールバック
node tools/enrich-contact.mjs --sheet <シート名> --url-column 公式サイト --use-places

# Places API のみ(公式サイトを巡回せず検索のみ)
node tools/enrich-contact.mjs --sheet <シート名> --places-only
```

---

## コマンド早見表

普段は Claude Code にお願いするだけでいいが、直接コマンドで叩くこともできる:

### 認証・設定

```bash
node auth-google.mjs                          # Google 認証
node tools/create-template-sheet.mjs          # 新規スプシ作成
node tools/init-spreadsheet.mjs --id <ID>     # 既存スプシに接続
```

### リサーチ

```bash
node tools/research.mjs --config <path>       # config JSON でリサーチ実行
node tools/research.mjs --config - --dry-run  # 書き込みなしで動作確認(stdin入力)
```

### 補助コマンド

```bash
node tools/research-helpers.mjs inspect-page --url "<URL>"   # ページ構造レポート
node tools/research-helpers.mjs search --query "<q>"          # Brave Search
node tools/research-helpers.mjs list-sheets                   # 過去のリサーチ一覧
```

### 連絡先エンリッチ(電話番号・メールの後追加)

```bash
# 既存シートの URL 列を起点に、公式サイトから電話番号・メールを抽出
node tools/enrich-contact.mjs --sheet <シート名> --url-column 公式サイト

# スクレイピング → 見つからなければ Places API で検索(BtoB 向け)
node tools/enrich-contact.mjs --sheet <シート名> --url-column 公式サイト --use-places

# Places API のみで補完(スクレイピングをスキップ)
node tools/enrich-contact.mjs --sheet <シート名> --places-only

# 件数を絞って試す
node tools/enrich-contact.mjs --sheet <シート名> --max 5
```

### スクリプト化と定期実行

```bash
node tools/run-scraper.mjs --list                      # 保存済みスクリプト一覧
node tools/run-scraper.mjs <名前>                      # 保存済みを実行
node tools/run-scraper.mjs <名前> --dry-run            # 動作確認

node tools/schedule.mjs --name <名前> --daily 09:00    # 毎日9時に登録
node tools/schedule.mjs --name <名前> --weekly mon=09:00  # 毎週月9時
node tools/schedule.mjs --name <名前> --every-hours 6  # 6時間ごと
node tools/schedule.mjs --name <名前> --remove         # 削除
node tools/list-schedules.mjs                          # 登録一覧
```

### ログの確認

```bash
tail -f ~/Library/Logs/scraping-agent/<名前>.log       # 定期実行の標準出力
tail -f ~/Library/Logs/scraping-agent/<名前>.err.log   # エラー
```

---

## スプレッドシート構成

### リサーチシート(`yyyyMMdd_<名前>`)

| 列 | 内容 |
|----|------|
| A: No. | 連番(自動) |
| B: タイトル | 会社名・案件名・競合名など |
| C: URL | 詳細ページのリンク |
| D: 取得日時 | 取得タイムスタンプ(自動) |
| E 以降 | リサーチ固有の項目(住所・電話・ジャンル・価格など、リサーチのたびに自由に決める) |

URLが同じ行は自動で重複スキップされる(2回目以降の追記に便利)。

---

## ディレクトリ構成

```
scraping-agent/
├── README.md                      # このファイル(ユーザー向け)
├── CLAUDE.md                      # エージェント用の全体指示書
├── setup/
│   └── SETUP-FOR-CC.md            # エージェント駆動セットアップ手順書
├── .claude/skills/                # Claude Code 用スキル
│   ├── setup/                     #  - 初期セットアップ
│   ├── research/                  #  - リサーチ実行
│   ├── save-as-script/            #  - スクリプト化
│   ├── schedule/                  #  - 定期実行登録
│   ├── manage/                    #  - 一覧/削除/ログ
│   └── extend-source/             #  - 新サイト・APIへのツール拡張
├── .cursor/skills/                # Cursor 用スキル(同内容)
├── docs/
│   └── integrations/              # 各コネクタの発行手順・料金・制約メモ
│       ├── _template.md           #  - 新規コネクタ作成時のテンプレ
│       ├── google-places.md
│       └── brave-search.md
├── auth-google.mjs                # Google OAuth(ブラウザ)
├── tools/
│   ├── lib/                       # 内部ライブラリ
│   │   ├── sheets.mjs             #  - Sheets API
│   │   ├── fetch.mjs              #  - 静的HTML 取得
│   │   ├── browser.mjs            #  - Puppeteer
│   │   ├── scraper.mjs            #  - 自動判定+統合
│   │   ├── throttle.mjs           #  - レート制限+リトライ
│   │   ├── robots.mjs             #  - robots.txt チェック
│   │   ├── brave-search.mjs       #  - Brave Search API
│   │   └── scrape-profiles.mjs    #  - サイト別"安全間隔"の記憶
│   ├── init-spreadsheet.mjs       # スプシ接続テスト
│   ├── create-template-sheet.mjs  # 空スプシ新規作成
│   ├── research.mjs               # 設定駆動のリサーチ実行エンジン
│   ├── research-helpers.mjs       # 補助コマンド群
│   ├── enrich-contact.mjs         # 既存シートに電話番号・メールを後追加
│   ├── save-as-script.mjs         # config を scrapers/<名前>.mjs に保存
│   ├── run-scraper.mjs            # 保存済みスクリプトを名前で実行
│   ├── schedule.mjs               # launchd スケジュール登録/削除
│   └── list-schedules.mjs         # 登録済みスケジュール一覧
├── scrapers/
│   ├── _template.mjs              # config 設定例(3モード分)
│   └── <名前>.mjs                 # 保存されたスクレイパー(追加されていく)
├── .scrape-profiles/              # サイト別設定(git管理外)
└── credentials/tokens.json        # Google OAuth トークン(git管理外)

# 実行時に作られる外部ファイル
~/Library/LaunchAgents/local.scraping-agent.<名前>.plist  # 定期実行の設定(プレフィックスは .env の LAUNCHD_LABEL_PREFIX で変更可)
~/Library/Logs/scraping-agent/<名前>.log / <名前>.err.log       # 実行ログ
```

---

## よくある質問

### Q. スクレイピングって違法じゃないの?

- このツールは robots.txt を自動で確認し、禁止されているページは取得しません
- リクエスト間隔は2秒+ジッターで、サイトに過負荷をかけないよう設計されています
- Cloudflare / CAPTCHA などアンチボット検知で自動停止します
- ただし、**利用規約で明示的に禁止されているサイトには使わないでください**(食べログ・Amazon など、規約を必ず確認)
- 取得したデータの営利利用にも制約がある場合があります。各サイトの規約を確認してから活用してください

### Q. スプシがどんどん増えていくんだけど?

リサーチごとにシートが増えていくのは仕様です。古いシートは不要になったらスプシ内で手動削除してください。

### Q. 定期実行が動いていないみたい

以下を確認:

1. Mac が起動しているか(スリープ中は実行されない)
2. `node tools/list-schedules.mjs` で登録が残っているか
3. `tail -f ~/Library/Logs/scraping-agent/<名前>.err.log` でエラーログを確認

nvm を使っていて「node: command not found」エラーが出るときは、スケジュールを削除して再登録し直してください:

```bash
node tools/schedule.mjs --name "<名前>" --remove
node tools/schedule.mjs --name "<名前>" --daily 09:00
```

### Q. Brave の無料枠(2000クエリ/月)を超えそう

- search-based モードはヒット件数 × 詳細ページ1回ずつの消費(search 1回 + 詳細訪問は消費0)
- 大量リサーチには、list-detail モードで直接対象サイトの一覧ページを使う方がクエリを消費しない
- どうしても足りない場合は Brave の有料プラン(月$5〜)を検討

### Q. 電話番号・メールアドレスが取れないサイトがあるんだけど?

そもそも **Webスクレイピングだけで電話番号を集めるのは効率が悪い** です。公式サイトに電話番号が載っていない企業がどんどん増えています。

**使い分けの指針:**

| 対象 | おすすめの取り方 |
|---|---|
| 店舗型ビジネス(飲食・美容・医療・小売・士業) | `places` モード(Google Maps から一発取得) |
| BtoB 企業(製造業・IT・卸売など) | list-detail でリスト化 → `enrich-contact.mjs` で電話番号を後追加 |

BtoB 企業の場合、Wantedly / Green / OpenWork / Baseconnect / Aperza などで企業名と URL の一覧だけ先に作り、そのあと `tools/enrich-contact.mjs --use-places` で:

1. 各社の公式サイトを巡回して `tel:` / `mailto:` を抽出
2. 見つからなければ `/contact` `/company` 等も試す
3. それでも空なら「会社名 + 市区町村」で Google Places を検索して補完

という多段処理で電話番号・メールを埋められます(既存の値は上書きしない安全設計)。

メールアドレスは、BtoB では「公式サイトの mailto: リンク」か「問い合わせフォーム経由」が主流で、スクレイピングで一括取得するのは難しいのが現状です。`info@<ドメイン>` や `contact@<ドメイン>` の推測送信が業界標準になっていることも多いです。

### Q. Google Places API の料金は実際どれくらい?

Maps Platform の無料クレジット月 $200 内で運用できます(2026年4月時点)。

- 50件のリサーチを1回(= 3 リクエスト分) → おおよそ $0.1 程度
- 月に 2000 件のリサーチ(= 120 リクエスト) → おおよそ $5 程度(= 無料クレジット内)
- 気になる場合は Google Cloud Console → 「お支払い」→ 「予算とアラート」で上限通知を設定しておくと安心

受講生のリサーチ用途(月 数千件レベル)なら、料金は事実上無料に収まります。

### Q. 対応していないサイトや API を使いたいときは?

AI と対話しながらツールを拡張できます。「ホットペッパーからも取れるようにして」「Notion に送りたい」等と言うと:

1. 対象の公式 API があるか AI が調査
2. 料金・無料枠を伝えてくれる
3. API キー発行手順をステップバイステップで案内
4. 発行できたら `.env` 更新 & コネクタ(`tools/lib/<name>.mjs`)を作成
5. 動作確認して、受講生配布に含めるかを確認

詳細は `.claude/skills/extend-source/SKILL.md`(AI が読むスキルファイル)に実装済み。
拡張した内容は `docs/integrations/<name>.md` に記録されるので、後で見返せます。

### Q. 実行前に何の情報を取りに行くか分からないのが不安

実行前の最終確認で、スプレッドシートの列構成を表形式で必ず見せます。

```
📋 スプレッドシート「20260421_<名前>」に、以下の列でデータを集めます:

| 列 | 見出し | 内容 | 備考(実例) |
|---|---|---|---|
| A | No. | 連番 | 自動 |
| B | タイトル | 店名 | 「魚民 新宿東口駅前店」 |
| C | URL | 詳細ページのリンク | |
| D | 取得日時 | | 自動 |
| E | 住所 | | 「東京都新宿区歌舞伎町1-2-3」 |
| F | 電話番号 | | 「03-1234-5678」 |
| ... | | | |
```

この段階で「項目を足す / 減らす / 見出し名を変える / 順番を変える」ができます。
OK を貰ってから実際にスクレイピングが走ります。

---

## 技術スタック

- **Node.js** (ESM)
- **Puppeteer** — JS描画ページの取得
- **cheerio** — HTML パース
- **googleapis** — Sheets API v4 + Drive API v3
- **Brave Search API** — 検索エンジン経由のリサーチ
- **Google Places API (New)** — 店舗型ビジネスの電話番号・住所・営業時間の取得

---

## ライセンス / 配布

MIT License 相当でご自由にご利用ください。改変・再配布も自由です。

配布元や連絡先情報は、受領者が必要に応じてこのセクションを書き換えてください。
