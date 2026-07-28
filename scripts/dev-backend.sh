#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
export WEBMUX_DEV_ISOLATED=1
export WEBMUX_DEV_STATE_SCOPE="$repo_root"

exec bash "$repo_root/scripts/run-with-isolated-tmux.sh" bun --watch "$repo_root/backend/src/server.ts"
