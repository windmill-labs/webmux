# wmdev

Web-based dashboard for managing Git worktrees with integrated terminals and AI agent support. Create, monitor, and interact with multiple isolated development environments — each running its own AI coding agent (Claude or Codex), backend, and frontend.

## Quick start

```bash
# 1. Install prerequisites
cargo install workmux          # worktree orchestrator
sudo apt install tmux           # (or brew install tmux)
curl -fsSL https://bun.sh/install | bash  # bun >1.3.5 required

# 2. Install wmdev globally (from repo root)
bun install && bun run build && bun link

# 3. Create a .wmdev.yaml in your project root (see Configuration below)

# 4. Start the dashboard from your project directory
wmdev                          # UI on http://localhost:5111
wmdev --port 8080              # or pick a custom port
```

## Configuration

wmdev reads a `.wmdev.yaml` file from the project root. This single file controls services, profiles, and Docker sandbox settings.

### Full schema

```yaml
# Services to monitor — each maps a display name to a port env var.
# The dashboard polls these ports to show health status.
services:
  - name: string             # Display name (e.g. "BE", "FE")
    portEnv: string          # Env var holding the port number (e.g. "BACKEND_PORT")

# Profiles define what runs inside a worktree.
profiles:
  default:                   # Required — used when no profile is specified
    name: string             # Profile identifier (e.g. "full")
    systemPrompt: string     # (optional) Instructions sent to the AI agent.
                             # Supports ${VAR} placeholders expanded from env.
    envPassthrough: string[] # (optional) Env vars to pass to the agent process

  sandbox:                   # (optional) Docker-based sandboxed profile
    name: string             # Profile identifier (e.g. "sandbox")
    image: string            # Docker image name (must be pre-built)
    systemPrompt: string     # (optional) Agent instructions (supports ${VAR})
    envPassthrough: string[] # (optional) Host env vars forwarded into the container
    extraMounts:             # (optional) Additional bind mounts
      - hostPath: string     # Host path (supports ~ for $HOME)
        guestPath: string    # (optional) Mount point inside container (defaults to hostPath)
        writable: boolean    # (optional) true = read-write, false/omit = read-only
```

### Defaults

If `.wmdev.yaml` is missing or empty, wmdev uses:

```yaml
services: []
profiles:
  default:
    name: default
```

### Example

```yaml
services:
  - name: BE
    portEnv: BACKEND_PORT
  - name: FE
    portEnv: FRONTEND_PORT

profiles:
  default:
    name: full

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
      - hostPath: ~/my-private-repo
        writable: true
    systemPrompt: >
      You are running inside a sandboxed container.
      Backend port: ${BACKEND_PORT}. Frontend port: ${FRONTEND_PORT}.
```

### Parameter reference

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `services[].name` | string | yes | Display name shown in the dashboard UI |
| `services[].portEnv` | string | yes | Name of the env var containing the service port (read from each worktree's `.env.local`) |
| `profiles.default.name` | string | yes | Identifier for the default profile |
| `profiles.default.systemPrompt` | string | no | System prompt for the agent; `${VAR}` placeholders are expanded at runtime |
| `profiles.default.envPassthrough` | string[] | no | Env vars passed through to the agent process |
| `profiles.sandbox.name` | string | yes (if sandbox profile used) | Identifier for the sandbox profile |
| `profiles.sandbox.image` | string | yes (if sandbox profile used) | Docker image for containers |
| `profiles.sandbox.systemPrompt` | string | no | System prompt for sandbox agents; `${VAR}` placeholders are expanded at runtime |
| `profiles.sandbox.envPassthrough` | string[] | no | Host env vars forwarded into the Docker container |
| `profiles.sandbox.extraMounts[].hostPath` | string | yes | Host filesystem path to mount (`~` expands to `$HOME`) |
| `profiles.sandbox.extraMounts[].guestPath` | string | no | Container mount path (defaults to `hostPath`) |
| `profiles.sandbox.extraMounts[].writable` | boolean | no | `true` for read-write; omit or `false` for read-only |

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

**Backend** — Bun/TypeScript HTTP + WebSocket server (`backend/src/server.ts`). Two interfaces:

- **REST API** (`/api/*`) — CRUD for worktrees. Wraps the `workmux` CLI to create/remove/merge worktrees. For sandbox profiles, manages Docker containers directly with published ports. The `GET /api/worktrees` endpoint enriches each worktree with its directory, assigned ports, and service health status.
- **WebSocket** (`/ws/*`) — Bidirectional terminal bridge between xterm.js in the browser and tmux sessions on the server.

**Frontend** — Svelte 5 SPA with Tailwind CSS and xterm.js (`frontend/src/`). Two-panel UI: worktree list sidebar + embedded terminal. Polls the REST API for status updates. Responsive layout with mobile pane navigation.

### Terminal streaming

The WebSocket provides a bidirectional bridge between xterm.js in the browser and a tmux session on the server:

```
Browser (xterm.js)  ←— WebSocket —→  Backend  ←— stdin/stdout pipes —→  script (PTY)  ←— tmux attach —→  tmux grouped session
```

When a worktree is selected, the frontend opens a WebSocket to `/ws/<worktree>` and sends an initial `resize` message with the terminal dimensions. The backend then:

1. Spawns `script -q -c "... tmux attach-session ..." /dev/null` — allocates a real PTY for proper terminal escape sequences.
2. Creates a **grouped tmux session**, which is a separate view into the same windows. This allows the dashboard and a real terminal to view the same worktree simultaneously.
3. Streams PTY stdout over the WebSocket as `{ type: "output" }` messages.
4. Writes keystrokes from `{ type: "input" }` messages to the PTY's stdin.
5. Handles `resize` events by calling `tmux resize-window`.

Output is buffered in a scrollback array (up to 5000 chunks) so reconnecting clients receive recent history immediately.

### Worktree profiles

When creating a worktree, you pick a profile that determines the environment:

| Profile | What it does |
|---------|-------------|
| `default` | Delegates to workmux — uses the pane layout and commands defined in your `.workmux.yaml` project config. wmdev doesn't manage panes or processes for this profile; workmux handles it all. |
| `sandbox` | Managed entirely by wmdev, decoupled from workmux. wmdev launches a Docker container, sets up agent + shell panes, and publishes service ports directly with `docker run -p`. |

### Docker sandbox containers

For sandbox profiles, wmdev manages Docker containers directly:

1. **Launch** — `docker run -d -p <ports>` with the configured image, mounts, and env vars
2. **Mounts** — Worktree dir (rw), main repo `.git` (ro), Claude config, plus any `extraMounts`
3. **Environment** — All `.env.local` vars + `envPassthrough` vars + `HOME`, `TERM`, `IS_SANDBOX=1`
4. **Cleanup** — Containers are removed when the worktree is removed or merged

## Prerequisites

| Tool | Min version | Purpose |
|------|-------------|---------|
| [**bun**](https://bun.sh) | >1.3.5 | Runtime for backend and frontend |
| [**workmux**](https://github.com/raine/workmux) | latest | Worktree + tmux orchestration (`cargo install workmux`) |
| **tmux** | 3.x | Terminal multiplexer |
| **git** | 2.x | Worktree management |
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
| `GET` | `/api/worktrees` | List all worktrees with status, ports, and service health |
| `POST` | `/api/worktrees` | Create a worktree (`{ branch, profile?, agent?, prompt? }`) |
| `DELETE` | `/api/worktrees/:name` | Remove a worktree |
| `POST` | `/api/worktrees/:name/open` | Open/focus a worktree's tmux window |
| `POST` | `/api/worktrees/:name/merge` | Merge worktree into main + cleanup |
| `GET` | `/api/worktrees/:name/status` | Get agent status for a worktree |
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

The frontend dev server runs on port `5112` and proxies `/api/*` and `/ws/*` to the backend.
