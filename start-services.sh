#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"
APP_HOST="${APP_HOST:-127.0.0.1}"
APP_PORT="${APP_PORT:-8000}"
export REDIS_URL="${REDIS_URL:-redis://${REDIS_HOST}:${REDIS_PORT}}"
export CELERY_BROKER_URL="${CELERY_BROKER_URL:-${REDIS_URL}/0}"
export CELERY_RESULT_BACKEND="${CELERY_RESULT_BACKEND:-${REDIS_URL}/1}"

if ! command -v redis-server >/dev/null 2>&1; then
  echo "redis-server is required but was not found in PATH." >&2
  exit 1
fi

if command -v uv >/dev/null 2>&1; then
  PYTHON_CMD=(uv run python)
elif [ -x "$ROOT_DIR/.venv/bin/python" ]; then
  PYTHON_CMD=("$ROOT_DIR/.venv/bin/python")
else
  echo "Neither 'uv' nor '.venv/bin/python' is available to run the app and worker." >&2
  exit 1
fi

wait_for_redis() {
  local attempts=30
  local sleep_seconds=1
  for ((i = 1; i <= attempts; i++)); do
    if "${PYTHON_CMD[@]}" -c "import socket; s=socket.socket(); s.settimeout(1); s.connect(('${REDIS_HOST}', ${REDIS_PORT})); s.close()" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$sleep_seconds"
  done
  return 1
}

redis_pid=""
worker_pid=""
app_pid=""

cleanup() {
  trap - EXIT INT TERM
  for pid in "$app_pid" "$worker_pid" "$redis_pid"; do
    if [ -n "${pid:-}" ] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
  wait >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

echo "Starting Redis on ${REDIS_HOST}:${REDIS_PORT}"
redis-server --bind "$REDIS_HOST" --port "$REDIS_PORT" --save "" --appendonly no &
redis_pid=$!

if ! wait_for_redis; then
  echo "Redis did not become ready in time." >&2
  exit 1
fi

echo "Starting Celery worker"
"${PYTHON_CMD[@]}" -m celery -A tasks.app worker --loglevel=info --pool=solo &
worker_pid=$!

echo "Starting FastAPI app on ${APP_HOST}:${APP_PORT}"
"${PYTHON_CMD[@]}" -m uvicorn main:app --host "$APP_HOST" --port "$APP_PORT" &
app_pid=$!

while true; do
  for service in redis worker app; do
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
