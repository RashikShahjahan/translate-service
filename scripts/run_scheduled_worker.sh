#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
uv_bin="${UV_BIN:-$(command -v uv)}"
active_start="${WORKER_ACTIVE_START_TIME:-00:00}"
active_end="${WORKER_ACTIVE_END_TIME:-08:00}"

if [[ -z "$uv_bin" ]]; then
  echo "uv was not found in PATH" >&2
  exit 1
fi

time_in_window() {
  local current_time="$1"
  local start_time="$2"
  local end_time="$3"

  if [[ "$start_time" == "$end_time" ]]; then
    return 0
  fi

  if [[ "$start_time" < "$end_time" ]]; then
    [[ "$current_time" > "$start_time" || "$current_time" == "$start_time" ]] &&
      [[ "$current_time" < "$end_time" ]]
    return
  fi

  [[ "$current_time" > "$start_time" || "$current_time" == "$start_time" || "$current_time" < "$end_time" ]]
}

seconds_until_window_end() {
  local current_time="$1"
  local end_time="$2"

  python3 - "$current_time" "$end_time" <<'PY'
from datetime import datetime, timedelta
import sys

current = datetime.strptime(sys.argv[1], "%H:%M")
end = datetime.strptime(sys.argv[2], "%H:%M")
if end <= current:
    end += timedelta(days=1)
print(int((end - current).total_seconds()))
PY
}

current_time="$(date +%H:%M)"
if ! time_in_window "$current_time" "$active_start" "$active_end"; then
  exit 0
fi

runtime_seconds="$(seconds_until_window_end "$current_time" "$active_end")"
if [[ "$runtime_seconds" -le 0 ]]; then
  exit 0
fi

cd "$repo_root"
"$uv_bin" run python src/worker.py &
worker_pid=$!

cleanup() {
  if kill -0 "$worker_pid" >/dev/null 2>&1; then
    kill -TERM "$worker_pid" >/dev/null 2>&1 || true
    wait "$worker_pid" || true
  fi
}

trap cleanup EXIT INT TERM

sleep "$runtime_seconds" &
timer_pid=$!

wait "$timer_pid"
cleanup
