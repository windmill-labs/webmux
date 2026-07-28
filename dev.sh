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
fi

if [ -z "${PORT:-}" ]; then
  read -r AUTO_BACKEND_PORT AUTO_FRONTEND_PORT < <(bun bin/src/dev-ports.ts 5111)
  export PORT="$AUTO_BACKEND_PORT"
  if [ -z "${FRONTEND_PORT:-}" ]; then
    export FRONTEND_PORT="$AUTO_FRONTEND_PORT"
  elif [ "$FRONTEND_PORT" = "$PORT" ]; then
    export PORT="$AUTO_FRONTEND_PORT"
  fi
fi

export FRONTEND_PORT="${FRONTEND_PORT:-$((PORT + 1))}"
echo "Starting isolated webmux dev servers (backend $PORT, frontend $FRONTEND_PORT)"

PIDS=()

cleanup() {
  if [ "${#PIDS[@]}" -gt 0 ]; then
    kill "${PIDS[@]}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Backend (bun --watch)
cd backend
bash ../scripts/dev-backend.sh > >(sed 's/^/[BE] /') 2>&1 &
BE_PID=$!
PIDS+=("$BE_PID")
cd ..

# Frontend (vite dev)
cd frontend
bun run dev > >(sed 's/^/[FE] /') 2>&1 &
FE_PID=$!
PIDS+=("$FE_PID")
cd ..

wait
