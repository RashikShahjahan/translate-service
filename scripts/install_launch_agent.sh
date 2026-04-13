#!/usr/bin/env bash

set -euo pipefail

worker_label="local.translate-service.worker"
domain="gui/$(id -u)"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
launch_agents_dir="$HOME/Library/LaunchAgents"
uv_bin="$(command -v uv)"
active_start="${WORKER_ACTIVE_START_TIME:-00:00}"
active_end="${WORKER_ACTIVE_END_TIME:-08:00}"

if [[ -z "$uv_bin" ]]; then
  echo "uv was not found in PATH" >&2
  exit 1
fi

mkdir -p "$launch_agents_dir"
mkdir -p "$repo_root/logs"
chmod +x "$repo_root/scripts/run_scheduled_worker.sh"

escaped_repo_root="${repo_root//\//\\/}"
escaped_uv_bin="${uv_bin//\//\\/}"

install_plist() {
  local label="$1"
  local template_path="$repo_root/launchd/$label.plist"
  local installed_plist="$launch_agents_dir/$label.plist"

  sed \
    -e "s/__WORKDIR__/$escaped_repo_root/g" \
    -e "s/__UV_BIN__/$escaped_uv_bin/g" \
    -e "s/__WORKER_ACTIVE_START_TIME__/$active_start/g" \
    -e "s/__WORKER_ACTIVE_END_TIME__/$active_end/g" \
    "$template_path" >"$installed_plist"

  launchctl bootout "$domain/$label" >/dev/null 2>&1 || true
  launchctl bootstrap "$domain" "$installed_plist"
}

install_plist "$worker_label"

rm -f "$launch_agents_dir/local.translate-service.worker.start.plist"
rm -f "$launch_agents_dir/local.translate-service.worker.stop.plist"

launchctl bootout "$domain/local.translate-service.worker.start" >/dev/null 2>&1 || true
launchctl bootout "$domain/local.translate-service.worker.stop" >/dev/null 2>&1 || true

echo "Installed LaunchAgent:"
echo "  $launch_agents_dir/$worker_label.plist"
echo "Worker label: $worker_label"
echo "Repo root: $repo_root"
echo "uv binary: $uv_bin"
echo "Worker schedule: $active_start to $active_end"
echo "Application log: $repo_root/logs/translate_service.log"
echo "LaunchAgent stderr: $repo_root/logs/worker.stderr.log"
