#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Usage: ./dev.sh [-p PORT]
while getopts "p:" opt; do
  case $opt in
    p) 
      export PORT="$OPTARG"
      export FRONTEND_PORT=$((PORT + 1))
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

cleanup() {
  kill $BE_PID $FE_PID 2>/dev/null || true
}
trap cleanup EXIT

# Backend (bun --watch)
cd backend
bun run dev 2>&1 | sed 's/^/[BE] /' &
BE_PID=$!
cd ..

# Frontend (vite dev)
cd frontend
bun run dev 2>&1 | sed 's/^/[FE] /' &
FE_PID=$!
cd ..

wait
