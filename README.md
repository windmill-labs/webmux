# wmdev

A web dashboard for managing parallel AI coding agents. Built on top of [workmux](https://github.com/raine/workmux), which handles git worktrees and tmux orchestration — wmdev adds a browser UI with embedded terminals, live status tracking, and CI integration.

https://github.com/user-attachments/assets/fa13366d-e758-4221-94bf-13a5738bf7e7

## Features

### Create & Manage Worktrees

![createanddelete-1 5x](https://github.com/user-attachments/assets/7f084d27-448c-47e4-aadf-8ab25154c096)

Spin up new worktrees with one click. Pick a profile, type a prompt, and wmdev creates the worktree, starts the agent, and begins streaming output. Merge or remove worktrees when you're done.

### Embedded Terminals

View and interact with your agents directly in the browser. Each worktree gets its own terminal session, streamed live via WebSocket. You can watch agents work, send prompts, and switch between worktrees instantly — no need to juggle tmux windows manually.

### PR, CI & Comments

![commentsandci-1 5x](https://github.com/user-attachments/assets/395f8471-f9ff-412a-87e2-1347bfadb387)

See pull request status, CI check results, and review comments right next to each worktree. No more switching to GitHub to check if your agent's PR passed CI.

### Service Health Monitoring

![monitor-1 5x](https://github.com/user-attachments/assets/b2cf535a-0242-4c15-bdb9-344dfde5f75e)

Track dev server ports across worktrees. wmdev polls configured services and shows live health badges so you know which worktrees have their servers running.

### Docker Sandbox Mode

<!-- gif -->

Run agents in isolated Docker containers for untrusted or experimental work. wmdev manages the container lifecycle, port forwarding, and volume mounts automatically.

## Quick Start

```bash
# 1. Install prerequisites
cargo install workmux          # or: brew install raine/workmux/workmux
sudo apt install tmux           # or: brew install tmux
curl -fsSL https://bun.sh/install | bash

# 2. Install wmdev
bun install -g wmdev

# 3. Set up your project
cd /path/to/your/project
wmdev init                     # creates .workmux.yaml and .wmdev.yaml

# 4. Start the dashboard
wmdev                          # opens on http://localhost:5111
```

## Prerequisites

| Tool | Purpose |
|------|---------|
| [**bun**](https://bun.sh) | Runtime |
| [**workmux**](https://github.com/raine/workmux) | Worktree + tmux orchestration |
| **tmux** | Terminal multiplexer |
| **git** | Worktree management |
| **gh** | PR and CI status (optional) |
| **docker** | Sandbox profile only (optional) |

## Configuration

wmdev uses two config files in the project root:

- **`.workmux.yaml`** — Controls worktree directory, pane layout, agent selection, and lifecycle hooks. See the [workmux docs](https://github.com/raine/workmux).
- **`.wmdev.yaml`** — Dashboard-specific config: service health checks, profiles, linked repos, and Docker sandbox settings.

<details>
<summary><strong>.wmdev.yaml example</strong></summary>

```yaml
name: My Project

services:
  - name: BE
    portEnv: BACKEND_PORT
    portStart: 5111
    portStep: 10
  - name: FE
    portEnv: FRONTEND_PORT
    portStart: 5112
    portStep: 10

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
      Backend port: ${BACKEND_PORT}. Frontend port: ${FRONTEND_PORT}.

linkedRepos:
  - repo: myorg/related-service
    alias: svc
```

</details>

<details>
<summary><strong>.wmdev.yaml full schema</strong></summary>

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | no | Project name shown in sidebar and browser tab |
| `services[].name` | string | yes | Display name shown in the dashboard |
| `services[].portEnv` | string | yes | Env var containing the service port |
| `services[].portStart` | number | no | Base port for auto-allocation |
| `services[].portStep` | number | no | Port increment per worktree slot (default: `1`) |
| `profiles.default.name` | string | yes | Identifier for the default profile |
| `profiles.default.systemPrompt` | string | no | Agent system prompt; `${VAR}` placeholders expanded at runtime |
| `profiles.default.envPassthrough` | string[] | no | Env vars passed to the agent process |
| `profiles.sandbox.name` | string | yes (if used) | Identifier for the sandbox profile |
| `profiles.sandbox.image` | string | yes (if used) | Docker image for containers |
| `profiles.sandbox.systemPrompt` | string | no | Agent system prompt for sandbox |
| `profiles.sandbox.envPassthrough` | string[] | no | Host env vars forwarded into the container |
| `profiles.sandbox.extraMounts[].hostPath` | string | yes | Host path to mount (`~` expands to `$HOME`) |
| `profiles.sandbox.extraMounts[].guestPath` | string | no | Container mount path (defaults to `hostPath`) |
| `profiles.sandbox.extraMounts[].writable` | boolean | no | `true` for read-write; omit or `false` for read-only |
| `linkedRepos[].repo` | string | yes | GitHub repo slug (e.g. `org/repo`) |
| `linkedRepos[].alias` | string | no | Short label for the UI |

</details>

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Up/Down` | Navigate between worktrees |
| `Cmd+K` | Create new worktree |
| `Cmd+M` | Merge selected worktree |
| `Cmd+D` | Remove selected worktree |
