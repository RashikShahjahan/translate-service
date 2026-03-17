#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
ROOT_DIR="$(pwd)"

[[ -f .env ]] && source .env

APP_HOST="${APP_HOST:-127.0.0.1}"
APP_PORT="${APP_PORT:-8000}"

if [[ -n "${PYTHONPATH:-}" ]]; then
  export PYTHONPATH="$ROOT_DIR/src:$PYTHONPATH"
else
  export PYTHONPATH="$ROOT_DIR/src"
fi

uv run python src/worker.py &
worker_pid=$!

trap 'kill "$worker_pid"' EXIT

exec uv run python -m uvicorn main:app --app-dir src --host "$APP_HOST" --port "$APP_PORT"
