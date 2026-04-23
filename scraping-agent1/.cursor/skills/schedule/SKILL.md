---
name: schedule
description: 保存済みスクレイパーを macOS launchd で定期実行する。「毎朝実行して」「定期実行したい」「スケジュール登録」等のトリガーで発動。
---

# 定期実行スキル

保存済みスクリプト(`scrapers/<名前>.mjs`)を macOS `launchd` で定期実行する。
Mac がスリープ中でも、次の復帰時に遅延実行してくれる(起動している必要はあるが)。

## 発動タイミング

1. save-as-script の結果報告で「定期実行をセット」を選んだとき
2. ユーザーが直接「定期実行して」「毎朝9時に回して」等

---

## ワークフロー

### Step 1. 対象スクリプトを確認する

直前の save-as-script から引き継いでいればその名前を使う。
そうでなければ、保存済み一覧から選んでもらう:

```bash
node tools/run-scraper.mjs --list
```

```text
どのスクリプトを定期実行しますか?

1. <スクリプト1>
2. <スクリプト2>
...
N. 別のスクリプト(リサーチから作り直す)
```

### Step 2. スケジュールを聞く(ナンバリング+箇条書き)

```text
どのペースで実行しますか?

1. 毎日決まった時刻(例: 毎朝9時)
2. 毎週決まった曜日と時刻(例: 毎週月曜9時)
3. 数時間おき(例: 6時間ごと)
4. その他(自由に教えてください)
```

ユーザーの回答に応じて具体の時刻・曜日・間隔を確認する:

#### 1. 毎日 → 時刻を確認

```text
時刻は何時がいいですか?(24時間形式 HH:MM。例: 09:00, 21:30)
```

#### 2. 毎週 → 曜日と時刻を確認

```text
曜日と時刻を教えてください:

1. 月曜日
2. 火曜日
3. 水曜日
4. 木曜日
5. 金曜日
6. 土曜日
7. 日曜日

例: 「月曜の9時」「水曜の21:30」
```

#### 3. 数時間おき

```text
何時間ごとに実行しますか?(1〜24 の数値で。小数点も可。例: 6, 12, 0.5)
```

### Step 3. 最終確認(メニュー形式)

```text
以下の内容で定期実行を登録します:

- スクリプト: <名前>
- スケジュール: <毎日09:00 / 毎週月9:00 / 6時間ごと など>
- ログ保存先: ~/Library/Logs/scraping-agent/<名前>.log
- 実行者: あなた(PCが起動している時のみ実行されます)

以下のどれで進めますか?

1. このまま登録
2. スケジュールを変更
3. plist の内容だけ確認(dry-run)
4. キャンセル
```

### Step 4. 登録する

登録コマンドは指定に応じて以下のいずれか:

```bash
# 毎日9時
node tools/schedule.mjs --name "<名前>" --daily 09:00

# 毎週月曜9時(曜日: sun mon tue wed thu fri sat)
node tools/schedule.mjs --name "<名前>" --weekly mon=09:00

# 6時間ごと
node tools/schedule.mjs --name "<名前>" --every-hours 6

# 登録済みを上書きしたい場合は --force を追加
```

**dry-run** で plist の内容だけ見たい場合:

```bash
node tools/schedule.mjs --name "<名前>" --daily 09:00 --dry-run
```

### Step 5. 結果報告

```text
定期実行を登録しました!

- 次の実行予定: <概算>
- ログ: ~/Library/Logs/scraping-agent/<名前>.log
- plist: ~/Library/LaunchAgents/<LAUNCHD_LABEL_PREFIX>.<名前>.plist(デフォルトは local.scraping-agent)

確認コマンド:
- 登録一覧: `node tools/list-schedules.mjs`
- 実行ログ: `tail -f ~/Library/Logs/scraping-agent/<名前>.log`
- 即座に1回実行して確認: `node tools/run-scraper.mjs <名前> --dry-run`

削除したいときはいつでも:
  `node tools/schedule.mjs --name "<名前>" --remove`
```

---

## 特殊ケースの対応

### 既に同名の登録がある場合

```text
⚠️ 「<名前>」は既にスケジュール登録済みです。

既存のスケジュール: <毎日09:00 など>

以下のどれで進めますか?

1. 上書きする(既存を削除して新しいスケジュールで登録)
2. 既存のまま残す(キャンセル)
3. 既存を削除だけする
```

**1** → `--force` を追加して再実行
**3** → `--remove` で削除

### Node.js のパス解決に失敗した場合

launchd は GUI セッションと環境変数が違うため、`node` コマンドがフルパスで指定されている必要がある。schedule.mjs は `which node` で解決するが、nvm 等を使っていると問題になることがある。

症状: 実行ログに「command not found: node」

対処: plist を編集して `/opt/homebrew/bin/node` など絶対パスに書き換える。または nvm 系なら:

```bash
# 現在の node のフルパスを確認
which node
# 例: /Users/<user>/.nvm/versions/node/v24.x.x/bin/node

# 既存の plist を削除して再登録
node tools/schedule.mjs --name "<名前>" --remove
# その後再登録(その時点の which node のフルパスが使われる)
node tools/schedule.mjs --name "<名前>" --daily 09:00
```

### Mac がスリープ中の扱い

- `StartCalendarInterval`(毎日・毎週指定) → スリープ中は実行されないが、**復帰時に遅延実行**される
- `StartInterval`(N秒ごと) → スリープ中はカウントストップ、復帰後に再開

常時実行が必要な場合はクラウド実行(Phase 4 以降で検討)を提案する。

---

## 関連スキル

- `research` → 新規リサーチ → 結果確認後に「スクリプト化」へ
- `save-as-script` → スクリプト化 → 結果確認後に「定期実行」へ(このスキル)
- `manage` → 登録一覧の確認、削除、履歴参照
