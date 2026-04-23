---
name: save-as-script
description: 直前のリサーチ設定を再利用可能なスクリプトとして保存する。「このリサーチ保存して」「スクリプト化して」「よく使うから残しておきたい」等のトリガーで発動。
---

# スクリプト化スキル

リサーチで組み立てた config を `scrapers/<名前>.mjs` に保存し、
2回目以降は即座に実行できるようにする。定期実行(schedule スキル)にも繋がる。

## 発動タイミング

1. **research スキルの結果報告後**: 「スクリプト化する」を選んだとき
2. **ユーザーが直接トリガー発話**: 「このリサーチ保存して」等

---

## ワークフロー

### Step 1. 保存する config を確認する

直前に使った config を保持しているはず(research スキル経由で発動した場合)。
そうでなければ、どのリサーチを保存するかをユーザーに聞く:

```text
どのリサーチをスクリプト化しますか?

1. 直前に実行したリサーチ(<リサーチ名>)
2. 別のリサーチ(内容を教えてください)
3. キャンセル
```

### Step 2. 保存名を確認する

```text
スクリプト名を決めましょう。以下のどれでいきますか?

1. <リサーチ名>(そのまま使う)
2. 別の名前を指定(英数字 / 日本語 / `_` / `-` が使えます)
```

**注意**: 日本語名はOKだが、ファイル名に使えない文字(スラッシュなど)は自動的に除去される。

### Step 3. 最終確認(メニュー形式)

```text
以下の内容で scripts 化します:

- 保存先: scrapers/<名前>.mjs
- モード: <single / list-detail / search-based>
- 取得項目: <...>
- 件数上限: <N>件
- 対象URL or 検索クエリ: <...>

以下のどれで進めますか?

1. このまま保存
2. 保存名を変更
3. config を編集(取得項目・件数・URLなど)
4. キャンセル
```

### Step 4. 保存を実行

config JSON を stdin で流して `tools/save-as-script.mjs` に渡す:

```bash
cat <<'JSON' | node tools/save-as-script.mjs --name "新宿_居酒屋"
{
  "name": "新宿_居酒屋",
  "mode": "list-detail",
  "maxItems": 50,
  ...
}
JSON
```

既存ファイルがある場合、上書きするかをユーザーに確認:

```text
scrapers/<名前>.mjs は既に存在します。以下のどれで進めますか?

1. 上書きする(--force)
2. 別の名前で保存する
3. キャンセル
```

### Step 5. 結果報告

保存できたら、次にできることを提示する:

```text
保存しました!

- ファイル: scrapers/<名前>.mjs
- 実行コマンド: node scrapers/<名前>.mjs
- 実行コマンド(別): node tools/run-scraper.mjs <名前>

次にやりたいことを選んでください:

1. 今すぐ実行して動作確認する(--dry-run で試すのも可)
2. 定期実行をセットする(毎朝9時・毎週月曜など)
3. セレクタの微調整をしたい(scrapers/<名前>.mjs を直接編集してOK)
4. 終了
```

ユーザーが **2** を選んだら、schedule スキルに引き継ぐ。

---

## 補足

### config をあとから編集したい場合

`scrapers/<名前>.mjs` は人間が読みやすい形で書かれている。
以下の部分を編集すれば、次回実行時から反映される:

- `maxItems`: 件数上限
- `throttle.delayMs`: リクエスト間隔(ミリ秒)
- `list.urls` / `urls` / `query`: 対象URL or 検索クエリ
- `list.parseItem` / `detail.fields` / `fields`: CSSセレクタと抽出方法

編集後は `node scrapers/<名前>.mjs --dry-run` で動作確認してから本実行を推奨。

### 削除したい場合

```bash
rm scrapers/<名前>.mjs
```

定期実行も登録していた場合は、schedule 側も削除する:

```bash
node tools/schedule.mjs --name "<名前>" --remove
```
