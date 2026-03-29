#!/usr/bin/env bash

set -euo pipefail

label="local.translate-service.worker"
domain="gui/$(id -u)"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
template_path="$repo_root/launchd/$label.plist"
launch_agents_dir="$HOME/Library/LaunchAgents"
installed_plist="$launch_agents_dir/$label.plist"
uv_bin="$(command -v uv)"

if [[ -z "$uv_bin" ]]; then
  echo "uv was not found in PATH" >&2
  exit 1
fi

mkdir -p "$launch_agents_dir"
mkdir -p "$repo_root/logs"

escaped_repo_root="${repo_root//\//\\/}"
escaped_uv_bin="${uv_bin//\//\\/}"
sed \
  -e "s/__WORKDIR__/$escaped_repo_root/g" \
  -e "s/__UV_BIN__/$escaped_uv_bin/g" \
  "$template_path" >"$installed_plist"

launchctl bootout "$domain/$label" >/dev/null 2>&1 || true

launchctl bootstrap "$domain" "$installed_plist"
launchctl kickstart -k "$domain/$label"

echo "Installed LaunchAgent: $installed_plist"
echo "Worker label: $label"
echo "Repo root: $repo_root"
echo "uv binary: $uv_bin"
echo "Application log: $repo_root/logs/translate_service.log"
echo "LaunchAgent stderr: $repo_root/logs/worker.stderr.log"
