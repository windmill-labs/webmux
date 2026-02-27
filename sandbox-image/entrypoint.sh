#!/bin/bash
set -euo pipefail

# ── Install dependencies ────────────────────────────────────────────────────
if [ -f "$PWD/bun.lock" ]; then
    bun install 2>/dev/null || true
fi

exec "$@"
