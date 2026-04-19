# Git確認メモ

このプロジェクトで `git` の状態を確認するときの見返し用メモです。

## 基本コマンド

まずはリポジトリのルート（このフォルダ）で実行します。

```bash
cd "/Users/user/addness/cursor/list-builder"
```

### 1. 今の状態を見る

```bash
git status
```

### 2. 短い表示で見る

```bash
git status --short
```

### 3. 無視されているファイルも含めて見る

```bash
git status --short --ignored
```

### 4. 直近のコミット履歴を見る

```bash
git log --oneline --decorate -n 10
```

### 5. まだコミットしていない差分を見る

```bash
git diff
```

### 6. 次にコミットされる差分を見る

```bash
git diff --staged
```

## 記号の意味

### `git status --short` の見方

```bash
 M README.md
M  package.json
A  tools/new-script.mjs
?? memo.txt
!! .env
```

- ` M`
  - 変更あり
  - まだ `git add` していない

- `M `
  - 変更あり
  - すでに `git add` 済み

- `A `
  - 新規ファイル
  - すでに `git add` 済み

- `??`
  - Gitがまだ管理していない新規ファイル

- `!!`
  - `.gitignore` で無視されているファイル

## `!!` の意味

このプロジェクトで `!!` が出るのは正常です。

例えばこういうものが無視されています。

```bash
.env
.env.save
credentials/
logs/
node_modules/
.DS_Store
```

これらは `git add .` してもコミット対象に入りません。

## このプロジェクトでコミットされないもの

`.gitignore` で除外しているもの:

```bash
node_modules/
.env
.env.*
!.env.example
credentials/
logs/
.DS_Store
```

つまり以下はコミットしない前提です。

```bash
.env
.env.save
credentials/tokens.json
logs/*
node_modules/*
.DS_Store
```

## いまの状態を確認する最小手順

迷ったらこれだけで十分です。

```bash
cd "/Users/user/addness/cursor/list-builder"
git status
git status --short --ignored
git log --oneline --decorate -n 5
```

## コミット前の確認手順

```bash
cd "/Users/user/addness/cursor/list-builder"
git status --short --ignored
git add .
git status
git diff --staged
```

確認ポイント:

- `.env` や `credentials/` がステージされていないこと
- `logs/` がステージされていないこと
- コミットしたいファイルだけが `Changes to be committed` に出ていること

## 最初のコミットを作る手順

```bash
cd "/Users/user/addness/cursor/list-builder"
git add .
git status
git commit -m "Initial project setup"
```

## GitHub に反映する手順

このプロジェクトの GitHub リポジトリ:

```bash
https://github.com/azuma-takumi/cc-camp-list-builder.git
```

新しい変更を反映するとき:

```bash
cd "/Users/user/addness/cursor/list-builder"
git status
git add .
git commit -m "更新内容"
git push
```

GitHub 側の最新を取り込むとき:

```bash
cd "/Users/user/addness/cursor/list-builder"
git pull
```

## このプロジェクトでの注意

- `記入者が東たくみ以外の行` は触らない
- `A列` は採番や色付きの仕組みがあるので触らない
- スプレッドシート追記時は `B列以降` のみを更新する

## 直近で起きた注意点

- `A列` を値で直接上書きすると、元の数式連番を壊す
- `取得場所` のプルダウン候補が元シートとコピーでずれることがある
- `@handle` の YouTube URL は環境によって扱いづらいので、`/channel/UC...` に統一すると安定しやすい
