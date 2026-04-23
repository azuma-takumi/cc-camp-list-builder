---
name: extend-source
description: 既存のツールでカバーできない新しいサイト・プラットフォーム・API に対応するため、必要な API キーの発行手順をユーザーに案内したり、新しいコネクタ(tools/lib/<name>.mjs)を追加したりして、scraping-agent 自体を拡張するスキル。「○○サイトも取れるようにして」「新しいデータソース追加して」「○○ API 使いたい」「このツール拡張して」などのトリガーで発動。research スキルから「現状のツールでは対応不可」と判定された場合も委譲される。
---

# サイト / データソース拡張スキル

scraping-agent は配布時点で想定できるサイト全てに対応させることは不可能。
ユーザーが「このサイトからも取りたい」と言ったら、**その場で調査 → 必要なセットアップ案内 → 実装 → 動作確認** を対話で完結させる。

拡張した内容は再利用できるように `docs/integrations/<source-name>.md` にまとめ、
必要に応じて `tools/lib/<source-name>.mjs` や `scrapers/<name>.mjs` を追加する。

---

## 絶対に守るルール

1. **ユーザーの意図を先に確認**: 「何を取りたいか」「1回限り or 継続運用か」「予算感」を聞いてから手段を決める
2. **公式 API を優先**: 公式 API がある場合は必ず最優先で検討する(合法性・安定性・速度の全てで優位)
3. **料金は必ず事前に明示**: 無料枠の範囲・有料になる条件・月額目安をユーザーに伝えてから発行を促す
4. **API キーの発行手順はステップバイステップで、画面上の具体的な位置も言葉で説明**(スクショは使えないので「左上のハンバーガーメニューから...」レベルで丁寧に)
5. **`.env` は必ず `.env.example` 側にもキー名+コメントを追記**(配布物としての一貫性)
6. **実装前に規約確認**: スクレイピングで進める場合は、対象サイトの利用規約とrobots.txtを必ず読んでユーザーに報告する
7. **勝手にやらない**: キー発行・課金設定・コード追加の各ステップでユーザーに確認を取る
8. **料金情報は必ず `registerApi()` で登録する**: 有料 API を新しく追加したら、コネクタのモジュールロード時に `registerApi()` で PRICING_META を登録し、各リクエスト送信直後に `trackRequest()` を呼ぶ(A-4.5 参照)。これを忘れるとリサーチ結果の 💰 費用ブロックに出なくなる

---

## 判定フロー(どのパターンでいくか)

ユーザーの欲しいものを聞いたら、以下のフローで進む:

```text
やりたいこと: <ユーザーが言ったこと>

以下のどれに近いですか?

1. 特定のプラットフォーム / サービスからデータを取りたい
   (例: ホットペッパー、Indeed、食べログ、Twitter/X、Reddit、YouTube など)
2. 特定のサイトをスクレイピングしたいが、現状のツールで上手くいかない
   (認証が必要 / JS 多用 / CAPTCHA で止まる など)
3. 自分の DB / API / Notion / Airtable 等と連携したい
4. その他(自由に教えてください)
```

### 選択肢ごとの分岐

- **1** → 下記「**A. 公式 API パターン**」を先に調べる → 見つかれば案内、なければ「**B. スクレイピングパターン**」へ
- **2** → 現象を切り分けて「**C. 認証/JS/アンチボットパターン**」へ
- **3** → 「**D. 外部連携パターン**」(このスキル末尾)
- **4** → 軽くヒアリングして 1〜3 に当てはめる

---

## A. 公式 API パターン(推奨)

公式 API がある場合、スクレイピングより圧倒的に合法・安定・高速。
**必ずこちらを第一候補として調査する**。

### A-1. 調査と報告

ユーザーに対象サービス名を聞いたら、以下を Web 検索 or 知識ベースで調べる:

- 公式 API の存在(`<サービス名> API` `<service> developer` で検索)
- 料金体系(無料枠・課金タイミング・最悪ケースの月額)
- 認証方式(API Key / OAuth2 / Bearer Token / HMAC)
- 主な取得可能データ(店舗情報 / 求人 / 動画 / ユーザー / 投稿など)
- 利用規約の概要(データ再配布・二次利用の制約)

結果をユーザーに報告する:

```text
<対象サービス> について調べました。

📊 公式API: <ある / ない / 要問い合わせ>

<ある場合>
- 名前: <API名、例: Hotpepper Gourmet API v1.3>
- 料金: <例: 無料(クレジットカード登録不要)。ただし月 50,000 リクエストまで>
- 認証: <APIキー / OAuth2 など>
- 取れる情報: <店舗名、住所、電話番号、営業時間、ジャンル、クーポン情報 等>
- 利用規約の注意点:
  - <重要な制約1>
  - <重要な制約2>
- ドキュメント: <公式ドキュメントURL>

📝 おすすめする使い方
1. このまま API で取得(推奨)
2. スクレイピング経由で取得(規約違反のリスクあり。非推奨)
3. 他のサービスから取る(< 代替1 >、< 代替2 > など)
4. 今は保留にして別のアプローチを考える

どれで進めますか?
```

### A-2. API キーの発行案内(ステップバイステップ)

ユーザーが「1」を選んだら、キー発行をガイドする。
**必ず以下のフォーマットで、画面上の位置を言葉で説明する**:

```text
<サービス名> の API キーを取ります。一緒に進めましょう。

### ステップ 1. アカウント作成 / ログイン
1. ブラウザで <公式ドキュメントURL> を開いてください
2. <ページ右上 or 中央の「Developer Registration」ボタン> をクリック
3. <メールアドレス・パスワードを入力 or Google ログイン>
4. 完了したら「できた」と教えてください

(ユーザーが "できた" と言ったら次へ)

### ステップ 2. API キー発行
1. ダッシュボードの <「API キー」「Credentials」「App 管理」などのリンク> を開いてください
2. <「新しいキーを作成」ボタン>
3. アプリ名を聞かれたら <"scraping-agent" などの任意の名前> を入れてください
4. 表示された API キー(文字列)をコピー

### ステップ 3. 料金制限の設定(安心のため)
<有料プランがある場合、使い過ぎ防止の方法を案内>
- 例: Google Cloud なら「予算とアラート」で月 $10 を上限設定
- 例: OpenAI なら Usage Limits で月 $5 を hard limit

### ステップ 4. .env に追加
API キーが取れたら教えてください。私が .env に書き込みます。
```

### A-3. `.env` / `.env.example` への追加

ユーザーからキーを受け取ったら、`.env` に追記する。
**同時に `.env.example` にもキー名とコメント** を追加する(配布物として次の受講生が見るため):

`.env.example` への追記形式:
```env
# ============================================================
# <サービス名> API
# ------------------------------------------------------------
# <用途・対応範囲>
# <料金の要約(無料枠N件までなど)>
# <公式ドキュメントURL>
# 詳しくは docs/integrations/<name>.md を参照
# ============================================================
<SERVICE>_API_KEY=
```

キー名のルール:
- サービス名を大文字スネークケースで `<SERVICE>_API_KEY`(例: `HOTPEPPER_API_KEY`、`INDEED_API_KEY`)
- OAuth の場合は `<SERVICE>_CLIENT_ID` / `<SERVICE>_CLIENT_SECRET`
- ベース URL が可変なら `<SERVICE>_BASE_URL` を添える

### A-4. コネクタの実装

`tools/lib/<name>.mjs` を作る。**既存の `google-places.mjs` / `brave-search.mjs` をお手本にする**:

```javascript
// tools/lib/<name>.mjs(テンプレート)
import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { registerApi, trackRequest } from "./usage.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "..", ".env") });

const API_ENDPOINT = "https://...";
const MIN_INTERVAL_MS = 1000; // サービスのレート制限に合わせる
let lastRequestTime = 0;

// A-4.5 で決めた PRICING_META を登録(詳細は A-4.5 参照)
registerApi("<name>", {
  label: "<表示名(例: My Example API)>",
  priceModel: "per-request",         // or "free-tier-quota" / "free"
  pricePerRequest: 0.01,             // USD。per-request のときのみ
  currency: "USD",
  freeTier: {
    description: "<例: 月 1,000 req 無料>",
    limit: 1000,                     // 数量無料枠(free-tier-quota)
    limitUsd: null,                  // 金額クレジット(Google Cloud 等)
  },
  dashboardUrl: "<実請求ダッシュボード URL>",
  note: null,
});

/**
 * 単発検索
 */
export async function search<Name>(query, options = {}) {
  const apiKey = process.env.<SERVICE>_API_KEY;
  if (!apiKey) {
    throw new Error(
      "<SERVICE>_API_KEY が .env に未設定です。docs/integrations/<name>.md の発行手順を参照してください。"
    );
  }

  await waitForRateLimit();
  const res = await fetch(API_ENDPOINT + "?" + new URLSearchParams({
    // クエリパラメータ
  }), {
    headers: { /* 認証ヘッダー */ },
  });

  // HTTP エラー応答でも API 呼び出しは課金されることがあるので、ステータスに関わらずカウント
  trackRequest("<name>");

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`<Service> API エラー: ${res.status} ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return {
    items: (data.items || []).map(normalize),
    raw: data,
  };
}

/**
 * ページネーション込みの一括取得
 */
export async function search<Name>Bulk(query, options = {}) {
  // 件数上限・ページトークン等を見て複数ページ取得
}

function normalize(item) {
  // API のレスポンスを { id, name, url, ... } のフラットな形に揃える
  return { /* ... */ };
}

async function waitForRateLimit() {
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
}
```

**既存の統一点**:
- 戻り値は `{ items: [...], raw: {...} }` に揃える(raw は後でデバッグしやすいように)
- エラーメッセージには **発行手順ドキュメントの場所** を含める
- `normalize` で flat な形に整形する(後段の research.mjs / enrich-contact.mjs から扱いやすい)
- **モジュールロード時に `registerApi()`、各リクエスト直後に `trackRequest()` を呼ぶ**(A-4.5 で詳細)

### A-4.5. 料金情報の登録(PRICING_META)

**なぜ登録が必要か**: リサーチ / エンリッチ実行後の 💰 ブロックに、この API の使用量・推定費用・今月累計が自動で出るようにするため。
登録しないと、受講生が「実際いくらかかるのか?」を確認できないまま使い続けることになる。

#### priceModel の選び方

| priceModel | 使いどころ | 例 |
|---|---|---|
| `"per-request"` | リクエスト毎に一定額が課金される(または Google Maps のような金額ベースの無料クレジット制) | Google Places / OpenAI 課金部分 / Stripe API |
| `"free-tier-quota"` | 月単位の「リクエスト数」無料枠があり、超えると別契約が必要 | Brave Search(2,000/月) / HotPepper(月50,000) |
| `"free"` | 完全無料、または社内/自前 API | Notion(認証済み) / 自前 DB |

#### 具体的な登録値(priceModel 別)

**per-request(Google Cloud 系など)**:
```javascript
registerApi("google-places", {
  label: "Google Places API (New)",
  priceModel: "per-request",
  pricePerRequest: 0.032,       // 1req あたりの USD 単価
  currency: "USD",
  freeTier: {
    description: "Google Maps Platform 月 $200 無料クレジット",
    limit: null,                // 数量ベースの上限はない
    limitUsd: 200,              // 金額ベースのクレジット($200)
  },
  dashboardUrl: "https://console.cloud.google.com/billing",
  note: "単価は目安。正確な請求は Cloud Console で確認",
});
```

**free-tier-quota(Brave / Hotpepper 等の月枠制)**:
```javascript
registerApi("brave-search", {
  label: "Brave Search API",
  priceModel: "free-tier-quota",
  currency: "USD",
  freeTier: {
    description: "Free プラン: 月 2,000 クエリ無料",
    limit: 2000,                // 月の無料リクエスト数上限
    limitUsd: null,
  },
  dashboardUrl: "https://api.search.brave.com/app/dashboard",
  note: "超過時は有料プラン($5/月〜)への切り替えが必要",
});
```

**free(完全無料 / 自前 API)**:
```javascript
registerApi("my-internal-api", {
  label: "自前 API",
  priceModel: "free",
});
```

#### トラッキングのルール(重要)

1. `trackRequest("<name>")` は **fetch の直後、`if (!res.ok)` の前** に呼ぶ
   - 理由: HTTP エラー応答でも API 呼び出し自体は課金されることがある
2. 認証エラー(401/403)は手前の `if (!apiKey)` で落ちるので、そこは登録外で OK
3. `registerApi()` はモジュールロード時(ファイルの top-level)で 1 回だけ呼ぶ。冪等(同名再登録は上書き)

#### 正確な単価がわからないとき

- 可能な限り公式料金ページを確認し、一番近いティア(Essentials / Pro 等)の値を入れる
- 本当に不明なときは `pricePerRequest: 0` にして `note` に「単価未検証」と明記
- 後日調整できる形にしておく(`docs/integrations/<name>.md` にも同じ値を転記)

#### .env の `USD_JPY_RATE`

AI 側で管理する固定換算レート(`tools/lib/usage.mjs` が読む)。
新しいコネクタを足すときに変更不要。ユーザーが `.env` で `USD_JPY_RATE=155` などに上書きできる。

### A-5. research.mjs への組み込み

簡単なパターンは **既存モードで済ませる**:
- データが「1リクエスト = N件の一覧が返る」形式 → `mode: "search-based"` のエンジンに新コネクタを挿す(要改修)、または新モード `<name>` を追加

複雑 or 頻繁に使うなら `tools/research.mjs` に新モード追加:
1. `runResearch` 関数の switch に分岐追加
2. `run<Name>` 関数を実装(Places の `runPlaces` が最もシンプルな例)
3. `scrapers/_template.mjs` に新モードのサンプル config を追加

### A-6. 動作確認

最小限の dry-run テスト:

```bash
echo '{"name":"test","mode":"<name>","query":"test","maxItems":3}' | \
  node tools/research.mjs --config - --dry-run
```

成功したら、少量(5〜10件)で本番実行してデータを目視確認。

### A-7. ドキュメント化(必須)

`docs/integrations/<name>.md` を作る。テンプレートは `docs/integrations/_template.md` 参照。

**最低限書くべきこと**:
- API 名・公式URL
- 料金(無料枠・課金条件)
- **コネクタへの料金登録(PRICING_META)** — A-4.5 で決めた `registerApi()` の引数をそのままコードブロックで転記
- 発行手順(A-2 で説明した内容をそのままコピペ)
- `.env` に必要なキー名
- コネクタファイルの場所
- レート制限・注意事項
- 動作確認済みの検索例

---

## B. スクレイピングパターン(公式 API がない場合)

### B-1. 事前チェック

**以下を必ず順にチェックし、ユーザーに報告してから進める**:

1. **利用規約** — 対象サイトの規約ページ(Terms of Service、利用規約)で「スクレイピング禁止」「自動アクセス禁止」「二次利用禁止」等の文言を確認
2. **robots.txt** — `curl https://<domain>/robots.txt` で確認
3. **実現可能性** — `node tools/research-helpers.mjs inspect-page --url "<代表URL>"` で構造を把握

結果報告:

```text
<対象サイト> のスクレイピング事前チェック:

1. 利用規約: < OK / グレー / NG >
   - <要約>
2. robots.txt: < 許可 / 一部禁止 / 全面禁止 >
   - <該当ルール>
3. ページ構造: < 静的HTML / JS描画 / 動的(認証必須) >
   - <見つかったセレクタ候補>

以下のどれで進めますか?

1. このまま list-detail / search-based モードで config を組む
2. 別のサイトに変える
3. 公式 API がないか探し直す
4. スクレイピングを諦めて手動取得にする
```

### B-2. 認証なしで取れる場合

`tools/research-helpers.mjs inspect-page` + `--selectors` で当たりをつけて、config JSON を組み立て、research スキルの通常フローに戻る。

**このパターンはコード追加不要**。config だけで対応できる。

`scrapers/<name>.mjs` として保存すれば再利用・スケジュール実行が可能(save-as-script スキル)。

### B-3. 認証が必要な場合 → 「C. 認証/JS パターン」へ

---

## C. 認証 / JS / アンチボットパターン

「ログインしないと見えない」「Cloudflare で止まる」「無限スクロール必須」などの難ケース。

### C-1. ログイン必須サイト(Cookie 方式)

ユーザーがブラウザでログインした状態の **Cookie をエクスポート** して使う方式が最も現実的。

```text
<対象サイト> はログインが必要です。以下の方法で進めましょう:

1. まずブラウザで <対象サイト> に普通にログインしてください
2. Chrome 拡張「EditThisCookie」や「Get cookies.txt LOCALLY」をインストール
3. ログイン後、拡張機能を開いて <対象ドメイン> の Cookie を JSON or Netscape 形式でエクスポート
4. エクスポートした Cookie を教えてください(ファイルをドラッグ&ドロップでも、内容をチャットに貼り付けでも OK)

⚠️ 注意:
- Cookie には自分のアカウント情報が含まれます。取り扱いに注意
- セッションが切れたら取り直し
- 他人に見せないでください(乗っ取りに使えてしまう)
```

Cookie を受け取ったら:
- `.<name>-cookies.json` としてプロジェクトルートに保存(`.gitignore` 追加)
- `tools/lib/browser.mjs` に `loadCookies` 機能がなければ追加
- config に `cookieFile: ".<name>-cookies.json"` を指定できるように改修

### C-2. JS 重装 / 無限スクロール

既に `tools/lib/browser.mjs`(Puppeteer)で対応可能。**通常フローで十分**。
無限スクロールのパラメータ(スクロール回数、待機時間)を config に書くだけ。

### C-3. Cloudflare / CAPTCHA

スクレイピングエンジンが自動検知して止まる。**無理に突破しない**:

```text
<対象サイト> は Cloudflare / CAPTCHA で保護されています。

このツールは規約遵守の観点から、これらの突破は行いません。
以下のいずれかで進めてください:

1. 公式 API があるか改めて調べる
2. 類似の別サイト(< 代替1 >、< 代替2 >)から取る
3. 「ヘッドフル Puppeteer + 手動 CAPTCHA 解答」の半手動方式にする
   (件数が少ない場合のみ現実的)
4. 今回は諦める
```

3 を選んだ場合は、Puppeteer を `headless: false` で起動して、
CAPTCHA 画面でユーザーに手動解答してもらう実装を提案する(サンプルは `docs/integrations/_captcha-manual.md` を参照)。

---

## D. 外部連携パターン(DB / Notion / Airtable / 自前 API)

スクレイピング結果を Google スプレッドシート以外に送りたいケース。

### D-1. Notion

- 公式 API あり(無料)
- `@notionhq/client` SDK を使う
- Integration を作って DB に接続
- コネクタ: `tools/lib/notion.mjs`(新規作成)
- `tools/research.mjs` の結果書き込み先を選択できるようオプション追加

### D-2. Airtable

- 公式 API あり(無料枠あり)
- Personal Access Token を発行
- コネクタ: `tools/lib/airtable.mjs`

### D-3. 自前 DB / API

ユーザーの API エンドポイント仕様を聞いてカスタム実装する。
テンプレート: `tools/lib/webhook.mjs`(POST で JSON を送るだけのシンプルなもの)

---

## 配布物への反映判断

新しいコネクタができたら、**受講生配布物に組み込むか** を毎回ユーザーに確認する:

```text
<新コネクタ> の動作確認ができました。以下を尋ねます:

1. このコネクタを受講生配布にも含めますか?
   a. 含める(README / CLAUDE.md / setup/SETUP-FOR-CC.md を更新、scrapers/_template.mjs にサンプル追加)
   b. 自分用に留める(docs/integrations/<name>.md は作るが、README 等には載せない)
   c. 一時使用(記録も残さない。今回だけ動けば良い)

2. キーの発行フローを他の受講生にも案内するなら、a を選んでください。
```

**a を選ばれた場合に更新するファイル**:
- `README.md` の「できること」に1行追加、ディレクトリ構成に追加
- `CLAUDE.md` のモード使い分け表、コマンド一覧、Phase 進捗に追加
- `setup/SETUP-FOR-CC.md` にステップ 2-D 以降としてキー発行手順を追加
- `.env.example` にキー名とコメントを追加
- `docs/integrations/<name>.md` は必ず作る(どのモードでも)

---

## トラブルシューティング

### ユーザーが「API キー取ったけど動かない」と言ったとき

以下を順にチェック:

1. `.env` への追記箇所が正しいか(キー名のタイポ)
2. キーに余計な空白や改行が入っていないか
3. コネクタが `.env` を読み込む前に `dotenv.config()` を呼んでいるか
4. 認証ヘッダーの形式が合っているか(`Bearer <token>` / `X-Api-Key` / URL パラメータ のどれか)
5. API の有効化スイッチ(Google Cloud / AWS など)がオンか
6. IP / リファラ制限がかかっていないか

### ユーザーが「料金が心配」と言ったとき

必ず以下を案内:

1. **事前課金アラートの設定方法**(サービスごとに異なる)
2. **小さい検索クエリで試す**(最大件数を 3〜5 に絞る)
3. **`--dry-run` で API を呼ばずにフロー検証**
4. **無料枠の消費状況の見方**(各サービスのダッシュボード)

---

## よくあるミス(避けるべき挙動)

- 🚫 料金を伝えずに API キー発行を促す → 必ず先に料金帯をユーザーに伝える
- 🚫 公式 API を探さずにスクレイピングに走る → まず API を調べる
- 🚫 利用規約を確認せずスクレイピングを提案する → 必ず確認してユーザーに報告
- 🚫 `.env.example` 側の更新を忘れる → 配布物の一貫性が崩れる。必ずペアで更新
- 🚫 コネクタだけ作って `docs/integrations/<name>.md` を書かない → 再現できなくなる
- 🚫 キーや Cookie を `.gitignore` せず実装する → ハードコード / `.env.local` など別の場所に漏れる経路を作らない
- 🚫 一度作ったコネクタを配布物に混ぜるかどうか確認しない → 受講生が戸惑う。常にユーザーに判断を仰ぐ
- 🚫 `registerApi()` / `trackRequest()` を呼ばない → 結果報告の 💰 ブロックに出ず、受講生が料金を把握できなくなる(A-4.5)
