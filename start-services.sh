#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

APP_HOST="${APP_HOST:-127.0.0.1}"
APP_PORT="${APP_PORT:-8000}"
export CELERY_BROKER_URL="${CELERY_BROKER_URL:-sqla+sqlite:///celery-broker.db}"
export CELERY_RESULT_BACKEND="${CELERY_RESULT_BACKEND:-db+sqlite:///celery-results.db}"

if command -v uv >/dev/null 2>&1; then
  PYTHON_CMD=(uv run python)
elif [ -x "$ROOT_DIR/.venv/bin/python" ]; then
  PYTHON_CMD=("$ROOT_DIR/.venv/bin/python")
else
  echo "Neither 'uv' nor '.venv/bin/python' is available to run the app and worker." >&2
  exit 1
fi

worker_pid=""
app_pid=""

cleanup() {
  trap - EXIT INT TERM
  for pid in "$app_pid" "$worker_pid"; do
    if [ -n "${pid:-}" ] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
  wait >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

echo "Starting Celery worker"
"${PYTHON_CMD[@]}" -m celery -A tasks.app worker --loglevel=info --pool=solo &
worker_pid=$!

echo "Starting FastAPI app on ${APP_HOST}:${APP_PORT}"
"${PYTHON_CMD[@]}" -m uvicorn main:app --host "$APP_HOST" --port "$APP_PORT" &
app_pid=$!

while true; do
  for service in worker app; do
    pid_var="${service}_pid"
    pid="${!pid_var}"
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      status=0
      wait "$pid" || status=$?
      echo "${service} exited with status ${status}" >&2
      exit "$status"
    fi
  done
  sleep 1
done
