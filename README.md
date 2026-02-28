# wmdev

Web dashboard for [workmux](https://github.com/raine/workmux). Provides a browser UI with embedded terminals, PR status monitoring, and CI integration on top of workmux's worktree + tmux orchestration.

## What is workmux?

[workmux](https://github.com/raine/workmux) is a CLI tool that orchestrates git worktrees and tmux. It pairs each worktree with a tmux window, provisions files (copy/symlink), runs lifecycle hooks, and has first-class AI agent support. A single `workmux add` creates the worktree, opens a tmux window with configured panes, and starts your agent. `workmux merge` merges the branch, deletes the worktree, closes the window, and cleans up branches.

workmux is configured via `.workmux.yaml` in the project root. See the [workmux README](https://github.com/raine/workmux) for full documentation.

## What wmdev adds

wmdev is a web UI that wraps workmux. It delegates core worktree lifecycle operations to the `workmux` CLI and adds browser-based features on top:

| Responsibility | Handled by |
|---|---|
| Create/remove/merge worktrees | **workmux** (wmdev calls `workmux add`, `workmux rm`, `workmux merge`) |
| Pane layout and agent launch (default profile) | **workmux** (uses `.workmux.yaml` pane config) |
| Open/focus a worktree's tmux window | **workmux** (`workmux open`) |
| List worktrees and agent status | **workmux** (`workmux list`, `workmux status`) |
| File provisioning and lifecycle hooks | **workmux** (`.workmux.yaml` `files` and `post_create`) |
| Browser terminal (xterm.js ↔ tmux) | **wmdev** |
| Service health monitoring (port polling) | **wmdev** |
| PR status tracking and badges | **wmdev** (polls `gh pr list`) |
| CI check status and failed log viewing | **wmdev** (calls `gh run view`) |
| Send prompts / PR comments to agents | **wmdev** (via `tmux load-buffer`) |
| Docker sandbox container lifecycle | **wmdev** (manages `docker run/rm` directly) |

## Quick start

```bash
# 1. Install prerequisites
cargo install workmux          # or: brew install raine/workmux/workmux
sudo apt install tmux           # or: brew install tmux
curl -fsSL https://bun.sh/install | bash

# 2. Clone and build
git clone https://github.com/centdix/wmdev.git
cd wmdev
bun install && bun run build && bun link

# 3. Set up your project
cd /path/to/your/project
workmux init                   # creates .workmux.yaml with sensible defaults

# 4. (Optional) Create a .wmdev.yaml for dashboard-specific config
#    See Configuration below

# 5. Start the dashboard
wmdev                          # UI on http://localhost:5111
wmdev --port 8080              # custom port
```

## Configuration

wmdev uses two config files in the project root:

- **`.workmux.yaml`** — workmux's own config. Controls worktree directory, pane layout, agent selection, file provisioning, lifecycle hooks, merge strategy, and more. See the [workmux docs](https://github.com/raine/workmux).
- **`.wmdev.yaml`** — dashboard-specific config. Controls service health checks, worktree profiles, linked repos for PR monitoring, and Docker sandbox settings.

### `.wmdev.yaml` schema

```yaml
# Services to monitor — each maps a display name to a port env var.
# The dashboard polls these ports and shows health status badges.
services:
  - name: string             # Display name (e.g. "BE", "FE")
    portEnv: string          # Env var holding the port (e.g. "BACKEND_PORT")

# Profiles define the environment when creating a worktree via the dashboard.
profiles:
  default:                   # Required — used when no profile is specified
    name: string             # Profile identifier
    systemPrompt: string     # (optional) Instructions for the AI agent.
                             # Supports ${VAR} placeholders expanded from .env.local.
    envPassthrough: string[] # (optional) Env vars to pass to the agent process

  sandbox:                   # (optional) Docker-based sandboxed profile
    name: string             # Profile identifier
    image: string            # Docker image name (must be pre-built)
    systemPrompt: string     # (optional) Agent instructions (supports ${VAR})
    envPassthrough: string[] # (optional) Host env vars forwarded into the container
    extraMounts:             # (optional) Additional bind mounts
      - hostPath: string     # Host path (supports ~ for $HOME)
        guestPath: string    # (optional) Mount point inside container (defaults to hostPath)
        writable: boolean    # (optional) true = read-write, false/omit = read-only

# Monitor PRs from other GitHub repos and show their status alongside
# worktree branches that share the same branch name.
linkedRepos:
  - repo: string             # GitHub repo slug (e.g. "org/repo")
    alias: string            # (optional) Short label shown in the UI
```

### Defaults

If `.wmdev.yaml` is missing or empty:

```yaml
services: []
profiles:
  default:
    name: default
linkedRepos: []
```

### Example

```yaml
services:
  - name: BE
    portEnv: DASHBOARD_PORT
  - name: FE
    portEnv: FRONTEND_PORT

profiles:
  default:
    name: default

  sandbox:
    name: sandbox
    image: my-sandbox
    envPassthrough:
      - AWS_ACCESS_KEY_ID
      - AWS_SECRET_ACCESS_KEY
    extraMounts:
      - hostPath: ~/.codex
        guestPath: /root/.codex
        writable: true
    systemPrompt: >
      You are running inside a sandboxed container.
      Backend port: ${DASHBOARD_PORT}. Frontend port: ${FRONTEND_PORT}.

linkedRepos:
  - repo: myorg/related-service
    alias: svc
```

### Parameter reference

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `services[].name` | string | yes | Display name shown in the dashboard |
| `services[].portEnv` | string | yes | Env var containing the service port (read from each worktree's `.env.local`) |
| `profiles.default.name` | string | yes | Identifier for the default profile |
| `profiles.default.systemPrompt` | string | no | System prompt for the agent; `${VAR}` placeholders expanded at runtime |
| `profiles.default.envPassthrough` | string[] | no | Env vars passed through to the agent process |
| `profiles.sandbox.name` | string | yes (if used) | Identifier for the sandbox profile |
| `profiles.sandbox.image` | string | yes (if used) | Docker image for containers |
| `profiles.sandbox.systemPrompt` | string | no | System prompt for sandbox agents; `${VAR}` placeholders expanded at runtime |
| `profiles.sandbox.envPassthrough` | string[] | no | Host env vars forwarded into the Docker container |
| `profiles.sandbox.extraMounts[].hostPath` | string | yes | Host path to mount (`~` expands to `$HOME`) |
| `profiles.sandbox.extraMounts[].guestPath` | string | no | Container mount path (defaults to `hostPath`) |
| `profiles.sandbox.extraMounts[].writable` | boolean | no | `true` for read-write; omit or `false` for read-only |
| `linkedRepos[].repo` | string | yes | GitHub repo slug (e.g. `org/repo`) |
| `linkedRepos[].alias` | string | no | Short label for the UI (defaults to repo name) |

### Auto-generated branch names

If your `.workmux.yaml` has `auto_name.model` configured, the create-worktree dialog will automatically generate a branch name from the prompt using that LLM. This is a workmux feature — wmdev detects it and enables the UI flow accordingly.

## Architecture

```
Browser (localhost:5111)
    │
    ├── REST API (/api/*)  ──┐
    └── WebSocket (/ws/*)  ──┤
                             │
                    Backend (Bun HTTP server)
                             │
              ┌──────────────┼──────────────┐
              │              │              │
          workmux CLI    tmux sessions   Docker
          (worktree       (terminal      (sandbox
           lifecycle)      access)        containers)
```

**Backend** — Bun/TypeScript HTTP + WebSocket server (`backend/src/server.ts`):

- **REST API** (`/api/*`) — CRUD for worktrees. Wraps the `workmux` CLI to create/remove/merge worktrees. Enriches each worktree with directory, assigned ports, service health, PR status, and agent state.
- **WebSocket** (`/ws/*`) — Bidirectional terminal bridge between xterm.js in the browser and tmux sessions on the server.

**Frontend** — Svelte 5 SPA with Tailwind CSS and xterm.js (`frontend/src/`). Two-panel layout: worktree sidebar + embedded terminal. Polls the REST API for status updates. Responsive with mobile pane navigation.

### Terminal streaming

```
Browser (xterm.js)  ←— WebSocket —→  Backend  ←— stdin/stdout pipes —→  script (PTY)  ←— tmux attach —→  tmux grouped session
```

When a worktree is selected, the frontend opens a WebSocket to `/ws/<worktree>`. The backend spawns a PTY via `script` and attaches to a **grouped tmux session** — a separate view into the same windows. This allows the dashboard and a real terminal to view the same worktree simultaneously.

Output is buffered (up to 1 MB) so reconnecting clients receive recent history immediately.

### Worktree profiles

| Profile | What it does |
|---------|-------------|
| `default` | Delegates to workmux — uses the pane layout and commands from `.workmux.yaml`. wmdev doesn't manage panes or processes; workmux handles it all. |
| `sandbox` | Managed by wmdev. Launches a Docker container, sets up agent + shell panes, and publishes service ports via `docker run -p`. |

### Docker sandbox containers

For sandbox profiles, wmdev manages Docker containers directly:

1. **Launch** — `docker run -d -p <ports>` with the configured image, mounts, and env vars. Runs as the host user (`--user uid:gid`) so file ownership matches.
2. **Mounts** — Worktree dir (rw), main repo `.git` (rw), main repo root (ro), `~/.claude` (dir) and `~/.claude.json` (settings file), plus any `extraMounts`. Conditionally mounts `~/.gitconfig`, `~/.ssh`, `~/.config/gh` if they exist.
3. **Environment** — All `.env.local` vars + `envPassthrough` vars + `HOME`, `TERM`, `IS_SANDBOX=1`.
4. **Cleanup** — Containers are removed when the worktree is removed or merged.

## Prerequisites

| Tool | Min version | Purpose |
|------|-------------|---------|
| [**bun**](https://bun.sh) | 1.3.5+ | Runtime for backend and frontend |
| [**workmux**](https://github.com/raine/workmux) | latest | Worktree + tmux orchestration |
| **tmux** | 3.x | Terminal multiplexer |
| **git** | 2.x | Worktree management |
| **gh** | 2.x | PR and CI status (optional — needed for PR badges and CI logs) |
| **docker** | 28+ | Only needed for sandbox profile |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DASHBOARD_PORT` | `5111` | Backend API port (also configurable via `--port`) |

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Up/Down` | Navigate between worktrees |
| `Cmd+K` | Create new worktree |
| `Cmd+M` | Merge selected worktree |
| `Cmd+D` | Remove selected worktree |

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/config` | Load dashboard config |
| `GET` | `/api/worktrees` | List all worktrees with status, ports, service health, and PR data |
| `POST` | `/api/worktrees` | Create a worktree (`{ branch?, profile?, agent?, prompt? }`) |
| `DELETE` | `/api/worktrees/:name` | Remove a worktree |
| `POST` | `/api/worktrees/:name/open` | Open/focus a worktree's tmux window |
| `POST` | `/api/worktrees/:name/merge` | Merge worktree into main + cleanup |
| `GET` | `/api/worktrees/:name/status` | Get agent status for a worktree |
| `POST` | `/api/worktrees/:name/send` | Send a prompt to the agent's tmux pane |
| `GET` | `/api/ci-logs/:runId` | Fetch failed CI run logs |
| `WS` | `/ws/:worktree` | Terminal WebSocket (xterm.js ↔ tmux) |

## Development

```bash
./dev.sh          # backend + frontend with hot reload, UI on :5112
```

Or start them separately:

```bash
# Terminal 1: backend (auto-reloads on save)
cd backend && bun run dev

# Terminal 2: frontend (Vite dev server)
cd frontend && bun run dev
```

The frontend dev server runs on port `5112` and proxies `/api/*` and `/ws/*` to the backend on `5111`.
