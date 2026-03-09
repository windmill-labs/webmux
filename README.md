# webmux

A web dashboard for managing parallel AI coding agents. webmux owns git worktree lifecycle, tmux layout, agent runtime events, service health monitoring, and sandbox containers directly.

https://github.com/user-attachments/assets/48c9564f-42a5-404f-97e2-c5ee0138f15d

## Features

### Create & Manage Worktrees

![createanddelete-1 5x](https://github.com/user-attachments/assets/7f084d27-448c-47e4-aadf-8ab25154c096)

Spin up new worktrees with one click. Pick a profile, type a prompt, and webmux creates the worktree, starts the agent, and begins streaming output. Merge or remove worktrees when you're done.

### Embedded Terminals

View and interact with your agents directly in the browser. Each worktree gets its own terminal session, streamed live via WebSocket. You can watch agents work, send prompts, and switch between worktrees instantly — no need to juggle tmux windows manually.

### PR, CI & Comments

![commentsandci-1 5x](https://github.com/user-attachments/assets/395f8471-f9ff-412a-87e2-1347bfadb387)

See pull request status, CI check results, and review comments right next to each worktree. No more switching to GitHub to check if your agent's PR passed CI.

### Service Health Monitoring

![monitor-1 5x](https://github.com/user-attachments/assets/b2cf535a-0242-4c15-bdb9-344dfde5f75e)

Track dev server ports across worktrees. webmux polls configured services and shows live health badges so you know which worktrees have their servers running.

### Docker Sandbox Mode

<!-- gif -->

Run agents in isolated Docker containers for untrusted or experimental work. webmux manages the container lifecycle, port forwarding, and volume mounts automatically.

### Linear Integration

<!-- gif -->

See your assigned Linear issues alongside your worktrees. webmux matches branches to issues automatically, so you can browse your backlog, pick an issue, and spin up a worktree for it in one click.

## Quick Start

```bash
# 1. Install prerequisites
sudo apt install tmux           # or: brew install tmux
sudo apt install python3        # or: brew install python
curl -fsSL https://bun.sh/install | bash

# 2. Install webmux
bun install -g webmux

# 3. Set up your project
cd /path/to/your/project
webmux init                     # creates .webmux.yaml

# 4. Start the dashboard
webmux                          # opens on http://localhost:5111
```

## Prerequisites

| Tool | Purpose |
|------|---------|
| [**bun**](https://bun.sh) | Runtime |
| **python3** | Per-worktree hook/event helper runtime |
| **tmux** | Terminal multiplexer |
| **git** | Worktree management |
| **gh** | PR and CI status (optional) |
| **docker** | Sandbox profile only (optional) |

## Configuration

webmux uses a single config file in the project root:

- **`.webmux.yaml`** — Worktree root, pane layout, service ports, profiles, linked repos, and Docker sandbox settings.

<details>
<summary><strong>.webmux.yaml example</strong></summary>

```yaml
name: My Project

workspace:
  mainBranch: main
  worktreeRoot: __worktrees
  defaultAgent: claude

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
    runtime: host
    yolo: false
    envPassthrough: []
    panes:
      - id: agent
        kind: agent
        focus: true
      - id: frontend
        kind: command
        split: right
        command: FRONTEND_PORT=$FRONTEND_PORT npm run dev

  sandbox:
    runtime: docker
    yolo: true
    image: my-sandbox
    envPassthrough:
      - AWS_ACCESS_KEY_ID
      - AWS_SECRET_ACCESS_KEY
    mounts:
      - hostPath: ~/.codex
        guestPath: /root/.codex
        writable: true
    systemPrompt: >
      You are running inside a sandboxed container.
      Backend port: ${BACKEND_PORT}. Frontend port: ${FRONTEND_PORT}.

linkedRepos:
  - repo: myorg/related-service
    alias: svc

startupEnvs:
  NODE_ENV: development

auto_name:
  model: claude-3-5-haiku-latest
  system_prompt: >
    Generate a concise git branch name from the task description.
    Return only the branch name in lowercase kebab-case.

lifecycleHooks:
  postCreate: scripts/post-create.sh
  preRemove: scripts/pre-remove.sh
```

</details>

<details>
<summary><strong>.webmux.yaml full schema</strong></summary>

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | no | Project name shown in sidebar and browser tab |
| `workspace.mainBranch` | string | no | Base branch used for new worktrees |
| `workspace.worktreeRoot` | string | no | Relative or absolute directory for managed worktrees |
| `workspace.defaultAgent` | string | no | Default agent for new worktrees |
| `services[].name` | string | yes | Display name shown in the dashboard |
| `services[].portEnv` | string | yes | Env var containing the service port |
| `services[].portStart` | number | no | Base port for auto-allocation |
| `services[].portStep` | number | no | Port increment per worktree slot (default: `1`) |
| `profiles.<name>.runtime` | string | yes | `host` or `docker` |
| `profiles.<name>.yolo` | boolean | no | Enables `--dangerously-skip-permissions` for Claude or `--yolo` for Codex |
| `profiles.<name>.panes[]` | array | yes | Pane layout for that profile |
| `profiles.<name>.panes[].kind` | string | yes | `agent`, `shell`, or `command` |
| `profiles.<name>.panes[].command` | string | yes (for `command`) | Startup command run inside the pane |
| `profiles.default.systemPrompt` | string | no | Agent system prompt; `${VAR}` placeholders expanded at runtime |
| `profiles.default.envPassthrough` | string[] | no | Env vars passed to the agent process |
| `profiles.sandbox.image` | string | yes (if used) | Docker image for containers |
| `profiles.sandbox.systemPrompt` | string | no | Agent system prompt for sandbox |
| `profiles.sandbox.envPassthrough` | string[] | no | Host env vars forwarded into the container |
| `profiles.sandbox.mounts[].hostPath` | string | yes | Host path to mount (`~` expands to `$HOME`) |
| `profiles.sandbox.mounts[].guestPath` | string | no | Container mount path (defaults to `hostPath`) |
| `profiles.sandbox.mounts[].writable` | boolean | no | `true` for read-write; omit or `false` for read-only |
| `integrations.github.linkedRepos[].repo` | string | yes | GitHub repo slug (e.g. `org/repo`) |
| `integrations.github.linkedRepos[].alias` | string | no | Short label for the UI |
| `startupEnvs.<KEY>` | string or boolean | no | Extra env vars materialized into worktree runtime env |
| `auto_name.model` | string | no | Model used to generate the branch name when the branch field is left empty; supports Anthropic (`claude-*`), Gemini (`gemini-*`), and OpenAI (`gpt-*`, `chatgpt-*`, `o*`) models |
| `auto_name.system_prompt` | string | no | System prompt sent to the auto-name model |
| `lifecycleHooks.postCreate` | string | no | Shell command run after a managed worktree is created and its runtime env is materialized, but before the tmux session/panes are started |
| `lifecycleHooks.preRemove` | string | no | Shell command run before a managed worktree is removed |

</details>

Lifecycle hooks run with the worktree as `cwd` and receive the same computed runtime env that the managed panes will use, including `startupEnvs`, allocated service ports, and `WEBMUX_*` metadata.

When `auto_name` is enabled, `webmux` calls the provider API directly with structured output and uses `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, or `OPENAI_API_KEY` based on the configured model.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Up/Down` | Navigate between worktrees |
| `Cmd+K` | Create new worktree |
| `Cmd+M` | Merge selected worktree |
| `Cmd+D` | Remove selected worktree |
