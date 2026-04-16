#!/usr/bin/env bash
# Cursor や長時間ジョブの作業中に Mac の自動スリープを抑える（macOS 標準 caffeinate）
# 終了: このターミナルで Ctrl+C、またはタブ／ウィンドウを閉じる
set -euo pipefail
echo "[keep-mac-awake] caffeinate -dims 中。終了は Ctrl+C"
exec caffeinate -dims bash -c 'tail -f /dev/null'
