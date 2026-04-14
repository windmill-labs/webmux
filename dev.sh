#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Usage: ./dev.sh [-p PORT]
CLI_PORT=""
while getopts "p:" opt; do
  case $opt in
    p)
      CLI_PORT="$OPTARG"
      ;;
    *) echo "Usage: $0 [-p backend_port]" >&2; exit 1 ;;
  esac
done

# Load env vars (R2 credentials, etc.) if present
if [ -f .env ]; then
  set -a; source .env; set +a
fi

# Load worktree-specific port assignments (PORT, FRONTEND_PORT)
if [ -f .env.local ]; then
  set -a; source .env.local; set +a
fi

if [ -n "$CLI_PORT" ]; then
  export PORT="$CLI_PORT"
  export FRONTEND_PORT=$((PORT + 1))
  export AGENTS_FRONTEND_PORT=$((PORT + 2))
fi

export PORT="${PORT:-5111}"
export FRONTEND_PORT="${FRONTEND_PORT:-$((PORT + 1))}"
export AGENTS_FRONTEND_PORT="${AGENTS_FRONTEND_PORT:-$((PORT + 2))}"

PIDS=()

cleanup() {
  if [ "${#PIDS[@]}" -gt 0 ]; then
    kill "${PIDS[@]}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Backend (bun --watch)
cd backend
bun run dev 2>&1 | sed 's/^/[BE] /' &
BE_PID=$!
PIDS+=("$BE_PID")
cd ..

# Frontend (vite dev)
cd frontend
bun run dev 2>&1 | sed 's/^/[FE] /' &
FE_PID=$!
PIDS+=("$FE_PID")
cd ..

# Agents frontend (vite dev)
cd agents-frontend
bun run dev 2>&1 | sed 's/^/[AFE] /' &
AFE_PID=$!
PIDS+=("$AFE_PID")
cd ..

wait
