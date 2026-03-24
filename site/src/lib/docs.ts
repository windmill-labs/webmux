import type {
  ConfigGroup,
  DocCommand,
  DocFact,
  DocFeature,
  DocsNavItem,
  DocStep,
  DocTool,
  Shortcut,
} from "./types";

export const docsNav: DocsNavItem[] = [
  { id: "overview", label: "Overview" },
  { id: "install", label: "Install" },
  { id: "quickstart", label: "Quick start" },
  { id: "cli", label: "CLI reference" },
  { id: "configuration", label: "Configuration" },
  { id: "schema", label: "Schema reference" },
  { id: "automation", label: "Automation" },
  { id: "shortcuts", label: "Shortcuts" },
];

export const featureHighlights: DocFeature[] = [
  {
    title: "Managed worktree lifecycle",
    description:
      "Create, open, close, remove, and merge worktrees through one dashboard or the CLI while keeping branch metadata and runtime state in sync.",
  },
  {
    title: "Embedded terminals and agent panes",
    description:
      "Each worktree can launch an agent pane plus shell or command panes so the browser mirrors the tmux layout you actually use for development.",
  },
  {
    title: "PR, CI, and comment visibility",
    description:
      "GitHub PR state, CI checks, and review comments are surfaced alongside each worktree instead of living in a separate tab.",
  },
  {
    title: "Service health and port management",
    description:
      "webmux allocates ports per worktree, polls configured services, and can expose direct service URLs through urlTemplate.",
  },
  {
    title: "Host and docker runtimes",
    description:
      "Profiles can run directly on the host or inside managed Docker containers with mounts, env passthrough, and per-profile prompts.",
  },
  {
    title: "Linear and linked repository context",
    description:
      "Linear issues and linked repos can be attached to worktrees so branch context, PRs, and external repo status stay visible together.",
  },
];

export const installCommand = "bun install -g webmux";

export const defaultsAtAGlance: DocFact[] = [
  { label: "Dashboard command", value: "webmux serve" },
  { label: "Default port", value: "5111 via --port or PORT" },
  { label: "Main branch default", value: "main" },
  { label: "Worktree root default", value: "../worktrees" },
  { label: "Default agent", value: "claude" },
  { label: "Auto-pull default", value: "disabled" },
  { label: "Linear integration default", value: "enabled: true" },
];

export const landingQuickStartSteps: DocStep[] = [
  {
    title: "Install prerequisites",
    description: "Install Bun and the required local tools webmux checks during setup.",
    command: "sudo apt install tmux python3\ncurl -fsSL https://bun.sh/install | bash",
    outcome: "On macOS, install tmux and python3 with Homebrew instead.",
  },
  {
    title: "Install the CLI",
    description: "Install the global webmux binary with Bun.",
    command: installCommand,
    outcome: "This places the webmux CLI in your global Bun bin directory.",
  },
  {
    title: "Initialize your repo",
    description: "Create a starter .webmux.yaml in the repository you want to manage.",
    command: "cd /path/to/your/project\nwebmux init",
    outcome:
      "webmux init requires a git repository and verifies git, bun, python3, and tmux before setup.",
  },
  {
    title: "Start the dashboard",
    description: "Launch the local dashboard server for the current project.",
    command: "webmux serve",
    outcome:
      "The dashboard runs on http://localhost:5111 by default. Add --app for Chromium app mode or use --port / PORT to override the port.",
  },
];

export const quickStartSteps: DocStep[] = [
  {
    title: "Install the CLI",
    description: "webmux runs on Bun and launches your dashboard locally.",
    command: installCommand,
    outcome: "Installs the webmux binary into your global Bun bin directory.",
  },
  {
    title: "Initialize your repo",
    description: "Create a project config in the repository you want to manage.",
    command: "cd /path/to/your/project\nwebmux init",
    outcome:
      "Checks dependencies, verifies Bun, optionally checks gh auth status, then creates or adapts .webmux.yaml at the git root.",
  },
  {
    title: "Start the dashboard",
    description: "Launch the local app and open the UI in your browser.",
    command: "webmux serve",
    outcome:
      "Starts the dashboard on http://localhost:5111 unless you override the port with --port or PORT. Add --app to open it in Chromium app mode.",
  },
  {
    title: "Create your first worktree",
    description: "Create a managed worktree from the CLI or from the dashboard UI.",
    command: "webmux add my-change --prompt \"ship the change\"",
    outcome:
      "webmux creates the worktree, allocates ports, runs lifecycle hooks, and starts the tmux session unless you pass --detach.",
  },
];

export const prerequisites: DocTool[] = [
  {
    name: "bun",
    purpose: "CLI runtime, package manager, and backend runtime.",
    installHint: "webmux init enforces Bun >= 1.3.5.",
  },
  {
    name: "git",
    purpose: "Worktree creation, branch management, and repository root discovery.",
  },
  {
    name: "tmux",
    purpose: "Session and pane orchestration behind the dashboard and CLI open/add flows.",
  },
  {
    name: "python3",
    purpose: "Helper runtime used by the event bridge for managed agent hooks.",
  },
  {
    name: "gh",
    purpose: "Optional, but enables GitHub PR, CI, and review-comment context in the UI.",
    optional: true,
    installHint: "If installed, webmux init also checks gh auth status.",
  },
  {
    name: "docker",
    purpose: "Optional, but required for docker runtime profiles and sandbox mounts.",
    optional: true,
  },
];

export const rootCommands: DocCommand[] = [
  {
    title: "serve",
    usage: "webmux serve [--port <number>] [--app] [--debug]",
    description: "Start the dashboard server for the current project.",
    details: [
      "Requires .webmux.yaml in the current directory.",
      "Reads .env.local first, then .env, before launching.",
      "Uses PORT as a fallback when --port is omitted.",
      "Use --app to open a Chromium-based app window after the backend starts.",
    ],
  },
  {
    title: "init",
    usage: "webmux init",
    description: "Interactive project setup for .webmux.yaml.",
    details: [
      "Must run inside a git repository.",
      "Checks git, bun, python3, and tmux, enforces Bun >= 1.3.5, then offers Claude, Codex, or manual starter generation.",
      "If gh is installed, warns when gh auth login is still needed.",
    ],
  },
  {
    title: "service",
    usage:
      "webmux service install [--port <number>]\nwebmux service uninstall\nwebmux service status\nwebmux service logs",
    description: "Manage webmux as a user-level service on Linux or macOS.",
    details: [
      "Uses systemctl --user on Linux and launchctl on macOS.",
      "install writes a service file that runs webmux serve --port ... from the git root.",
      "Not supported on other platforms.",
    ],
  },
  {
    title: "update",
    usage: "webmux update",
    description: "Upgrade the globally installed CLI with Bun.",
    details: ["Runs bun install --global webmux@latest under the hood."],
  },
  {
    title: "completion",
    usage: "webmux completion <bash|zsh>",
    description: "Emit shell completion setup for bash or zsh.",
    details: [
      "Completions include worktree branch names for open, close, remove, merge, and send.",
      "Add the output to your shell config with eval \"$(webmux completion zsh)\" or the bash equivalent.",
    ],
  },
];

export const worktreeCommands: DocCommand[] = [
  {
    title: "add",
    usage:
      "webmux add [branch] [--base <branch>] [--profile <name>] [--agent <claude|codex>] [--prompt <text>] [--env KEY=VALUE] [--detach]",
    description: "Create a managed worktree through the same lifecycle the dashboard uses.",
    details: [
      "Branch is optional. When omitted, webmux uses auto_name if configured, otherwise it generates a change-<id> branch name.",
      "Use --base to override workspace.mainBranch for a new worktree.",
      "Repeat --env KEY=VALUE to override runtime env values for that worktree.",
      "After creation, webmux switches tmux to the new worktree window unless you pass --detach.",
    ],
  },
  {
    title: "list",
    usage: "webmux list",
    description: "List managed worktrees, open or closed state, and saved profile / agent metadata.",
  },
  {
    title: "open",
    usage: "webmux open <branch>",
    description: "Open an existing worktree session and rebuild its tmux layout.",
  },
  {
    title: "close",
    usage: "webmux close <branch>",
    description: "Close the tmux session for a worktree without deleting the worktree directory.",
  },
  {
    title: "remove",
    usage: "webmux remove <branch>",
    description: "Delete a managed worktree and run preRemove if configured.",
  },
  {
    title: "merge",
    usage: "webmux merge <branch>",
    description: "Merge the worktree branch into workspace.mainBranch and remove the worktree.",
  },
  {
    title: "send",
    usage:
      "webmux send <branch> <prompt> [--preamble <text>]\nwebmux send <branch> --prompt <text> [--preamble <text>]",
    description: "Send a prompt to a running worktree agent through the local webmux server.",
    details: [
      "Use --prompt as an alternative to the positional prompt argument, but not both.",
      "Use --preamble to prepend extra context before the prompt body.",
      "This command posts to the current server port, so webmux serve must be running.",
    ],
  },
  {
    title: "prune",
    usage: "webmux prune",
    description: "Confirm and remove every managed worktree in the current project.",
    details: [
      "Prompts before deleting anything.",
      "Removes only the current project's managed worktrees.",
    ],
  },
];

export const landingConfigPreview = `name: My Project

workspace:
  mainBranch: main
  worktreeRoot: ../worktrees
  defaultAgent: claude
  autoPull:
    enabled: true
    intervalSeconds: 300

services:
  - name: API
    portEnv: PORT
    portStart: 3000
  - name: Frontend
    portEnv: FRONTEND_PORT
    portStart: 5173

profiles:
  default:
    runtime: host
    panes:
      - id: agent
        kind: agent
        focus: true
      - id: web
        kind: command
        split: right
        cwd: repo
        workingDir: frontend
        command: FRONTEND_PORT=$FRONTEND_PORT bun run dev

  sandbox:
    runtime: docker
    image: ghcr.io/your-org/your-image:latest
    yolo: true`;

export const keyboardShortcuts: Shortcut[] = [
  { keys: "Cmd+Up / Cmd+Down", action: "Move between worktrees" },
  { keys: "Cmd+K", action: "Create a new worktree" },
  { keys: "Cmd+M", action: "Merge the selected worktree" },
  { keys: "Cmd+D", action: "Remove the selected worktree" },
];

export const configExample = `name: My Project

workspace:
  mainBranch: main
  worktreeRoot: ../worktrees
  defaultAgent: claude
  autoPull:
    enabled: true
    intervalSeconds: 300

services:
  - name: API
    portEnv: PORT
    portStart: 3000
    portStep: 10
    urlTemplate: http://127.0.0.1:\${PORT}
  - name: FE
    portEnv: FRONTEND_PORT
    portStart: 5173
    portStep: 10
    urlTemplate: http://127.0.0.1:\${FRONTEND_PORT}

profiles:
  default:
    runtime: host
    systemPrompt: >
      You are working in \${WEBMUX_WORKTREE_PATH}
    envPassthrough:
      - GITHUB_TOKEN
    panes:
      - id: agent
        kind: agent
        focus: true
      - id: shell
        kind: shell
        split: right
        sizePct: 25
      - id: frontend
        kind: command
        split: bottom
        cwd: repo
        workingDir: frontend
        command: FRONTEND_PORT=$FRONTEND_PORT bun run dev

  sandbox:
    runtime: docker
    image: webmux-sandbox
    yolo: true
    envPassthrough:
      - AWS_ACCESS_KEY_ID
      - AWS_SECRET_ACCESS_KEY
    mounts:
      - hostPath: ~/.codex
        guestPath: /root/.codex
        writable: true
    panes:
      - id: agent
        kind: agent
        focus: true

startupEnvs:
  NODE_ENV: development
  FEATURE_FLAG: true

integrations:
  github:
    autoRemoveOnMerge: true
    linkedRepos:
      - repo: myorg/related-service
        alias: related
        dir: ../related-service
  linear:
    enabled: true
    autoCreateWorktrees: true
    createTicketOption: true
    teamId: eng

lifecycleHooks:
  postCreate: scripts/post-create.sh
  preRemove: scripts/pre-remove.sh

auto_name:
  provider: claude
  model: claude-3-5-haiku-latest
  system_prompt: >
    Generate a concise git branch name from the task description.
    Return only the branch name.`;

export const configGroups: ConfigGroup[] = [
  {
    title: "Project and workspace",
    description:
      "Top-level project identity and default workspace behavior. These values are loaded from the git root containing .webmux.yaml.",
    fields: [
      {
        key: "name",
        type: "string",
        required: "no",
        defaultValue: "Webmux",
        description: "Project name shown in the sidebar and browser title.",
      },
      {
        key: "workspace.mainBranch",
        type: "string",
        required: "no",
        defaultValue: "main",
        description: "Base branch used for merge targets and new worktrees.",
      },
      {
        key: "workspace.worktreeRoot",
        type: "string",
        required: "no",
        defaultValue: "../worktrees",
        description: "Relative or absolute directory where managed worktrees are created.",
      },
      {
        key: "workspace.defaultAgent",
        type: "claude | codex",
        required: "no",
        defaultValue: "claude",
        description: "Default agent kind used when a worktree does not specify one explicitly.",
      },
      {
        key: "workspace.autoPull.enabled",
        type: "boolean",
        required: "no",
        defaultValue: "false",
        description: "Periodically fetches and fast-forwards workspace.mainBranch when enabled.",
      },
      {
        key: "workspace.autoPull.intervalSeconds",
        type: "number",
        required: "no",
        defaultValue: "300 (minimum 30)",
        description: "Seconds between auto-pull attempts when autoPull is enabled.",
      },
    ],
  },
  {
    title: "Services",
    description:
      "Service definitions drive port allocation, health checks, and optional direct links in the UI.",
    fields: [
      {
        key: "services[].name",
        type: "string",
        required: "yes",
        description: "Display name shown in the dashboard.",
      },
      {
        key: "services[].portEnv",
        type: "string",
        required: "yes",
        description: "Runtime env key where the allocated port is injected.",
      },
      {
        key: "services[].portStart",
        type: "number",
        required: "no",
        description: "Base port for auto-allocation across worktrees.",
      },
      {
        key: "services[].portStep",
        type: "number",
        required: "no",
        defaultValue: "1",
        description: "Increment between worktree slots when ports are auto-allocated.",
      },
      {
        key: "services[].urlTemplate",
        type: "string",
        required: "no",
        description: "Expanded with runtime env values to generate a clickable service URL.",
      },
    ],
  },
  {
    title: "Profiles",
    description:
      "Profiles describe how a worktree runs: runtime, env passthrough, pane layout, prompts, and optional docker settings.",
    fields: [
      {
        key: "profiles.<name>.runtime",
        type: "host | docker",
        required: "no",
        defaultValue: "host (or docker for a sandbox profile)",
        description: "Execution runtime for the profile.",
      },
      {
        key: "profiles.<name>.envPassthrough",
        type: "string[]",
        required: "no",
        defaultValue: "[]",
        description: "Host env vars forwarded into the agent or container runtime.",
      },
      {
        key: "profiles.<name>.systemPrompt",
        type: "string",
        required: "no",
        description: "Prompt template applied to the agent for that profile.",
      },
      {
        key: "profiles.<name>.yolo",
        type: "boolean",
        required: "no",
        defaultValue: "false",
        description: "Enables permissive execution flags for compatible agent CLIs.",
      },
      {
        key: "profiles.<name>.image",
        type: "string",
        required: "conditional",
        description: "Docker image name. Required when runtime is docker.",
      },
      {
        key: "profiles.<name>.mounts[]",
        type: "MountSpec[]",
        required: "no",
        description: "Host/container mounts for docker profiles.",
      },
      {
        key: "profiles.<name>.panes[]",
        type: "PaneTemplate[]",
        required: "no",
        defaultValue: "[agent, shell]",
        description: "Ordered tmux pane layout for the worktree session.",
      },
    ],
  },
  {
    title: "Pane templates and mounts",
    description:
      "Pane entries control what opens in tmux, while mount specs shape docker filesystem access.",
    fields: [
      {
        key: "panes[].id",
        type: "string",
        required: "no",
        defaultValue: "pane-N",
        description: "Stable pane identifier used by the session layout.",
      },
      {
        key: "panes[].kind",
        type: "agent | shell | command",
        required: "yes",
        description: "Pane behavior. command requires a startup command string.",
      },
      {
        key: "panes[].split",
        type: "right | bottom",
        required: "no",
        defaultValue: "right (after the first pane)",
        description: "Split direction relative to the previously created pane.",
      },
      {
        key: "panes[].sizePct",
        type: "number",
        required: "no",
        description: "Optional pane size percentage for the split.",
      },
      {
        key: "panes[].focus",
        type: "boolean",
        required: "no",
        defaultValue: "false",
        description: "Marks the pane that should receive initial focus.",
      },
      {
        key: "panes[].command",
        type: "string",
        required: "conditional",
        description: "Startup command for command panes.",
      },
      {
        key: "panes[].workingDir",
        type: "string",
        required: "no",
        description: "Directory to cd into before running a command pane startup command.",
      },
      {
        key: "panes[].cwd",
        type: "repo | worktree",
        required: "no",
        defaultValue: "worktree",
        description: "Whether the pane starts in the repository root or the worktree root.",
      },
      {
        key: "mounts[].hostPath",
        type: "string",
        required: "yes",
        description: "Host path to mount into docker.",
      },
      {
        key: "mounts[].guestPath",
        type: "string",
        required: "no",
        defaultValue: "hostPath",
        description: "Container mount path. When omitted, the host path is reused.",
      },
      {
        key: "mounts[].writable",
        type: "boolean",
        required: "no",
        defaultValue: "false",
        description: "When true, the mount is read-write instead of read-only.",
      },
    ],
  },
  {
    title: "Startup envs and integrations",
    description:
      "These sections enrich the runtime environment and hook webmux into related tools and repositories.",
    fields: [
      {
        key: "startupEnvs.<KEY>",
        type: "string | boolean",
        required: "no",
        defaultValue: "{}",
        description: "Additional env vars materialized into the managed worktree runtime.",
      },
      {
        key: "integrations.github.linkedRepos[].repo",
        type: "string",
        required: "yes",
        description: "GitHub repo slug used for linked PR and CI context.",
      },
      {
        key: "integrations.github.linkedRepos[].alias",
        type: "string",
        required: "no",
        description: "Short label shown in the UI. Defaults to the repo basename.",
      },
      {
        key: "integrations.github.linkedRepos[].dir",
        type: "string",
        required: "no",
        description: "Optional repo path used for editor or deep-link integrations.",
      },
      {
        key: "integrations.github.autoRemoveOnMerge",
        type: "boolean",
        required: "no",
        defaultValue: "false",
        description: "Automatically removes managed worktrees when their PRs merge.",
      },
      {
        key: "integrations.linear.enabled",
        type: "boolean",
        required: "no",
        defaultValue: "true",
        description: "Turns Linear issue fetching on or off globally.",
      },
      {
        key: "integrations.linear.autoCreateWorktrees",
        type: "boolean",
        required: "no",
        defaultValue: "false",
        description: "Automatically creates worktrees for eligible assigned Linear issues.",
      },
      {
        key: "integrations.linear.createTicketOption",
        type: "boolean",
        required: "no",
        defaultValue: "false",
        description: "Shows the create-ticket action in the dashboard when Linear integration is enabled.",
      },
      {
        key: "integrations.linear.teamId",
        type: "string",
        required: "no",
        description: "Restricts Linear issue sync to a specific team id.",
      },
    ],
  },
  {
    title: "Lifecycle hooks and auto naming",
    description:
      "Automation sections that run scripts or generate branch names for new worktrees.",
    fields: [
      {
        key: "lifecycleHooks.postCreate",
        type: "string",
        required: "no",
        description: "Shell command run after a managed worktree is created but before panes start.",
      },
      {
        key: "lifecycleHooks.preRemove",
        type: "string",
        required: "no",
        description: "Shell command run before a managed worktree is removed.",
      },
      {
        key: "auto_name.provider",
        type: "claude | codex",
        required: "yes (if auto_name is set)",
        description: "CLI backend used for branch-name generation.",
      },
      {
        key: "auto_name.model",
        type: "string",
        required: "no",
        description: "Optional model name passed through to the selected CLI.",
      },
      {
        key: "auto_name.system_prompt",
        type: "string",
        required: "no",
        description: "Overrides the built-in branch naming prompt.",
      },
    ],
  },
];

export const runtimeEnvGroups: ConfigGroup[] = [
  {
    title: "Managed runtime variables",
    description:
      "webmux writes runtime env files for managed worktrees and injects these variables into panes and lifecycle hooks, alongside startupEnvs, allocated service ports, and worktree-local .env.local values.",
    fields: [
      {
        key: "WEBMUX_WORKTREE_ID",
        type: "string",
        required: "set by webmux",
        description: "Stable worktree identifier used by the control plane and runtime metadata.",
      },
      {
        key: "WEBMUX_BRANCH",
        type: "string",
        required: "set by webmux",
        description: "Resolved branch or worktree name for the managed worktree.",
      },
      {
        key: "WEBMUX_PROFILE",
        type: "string",
        required: "set by webmux",
        description: "Selected profile name for that worktree.",
      },
      {
        key: "WEBMUX_AGENT",
        type: "string",
        required: "set by webmux",
        description: "Resolved agent kind, such as claude or codex.",
      },
      {
        key: "WEBMUX_RUNTIME",
        type: "string",
        required: "set by webmux",
        description: "Resolved runtime kind, such as host or docker.",
      },
      {
        key: "WEBMUX_WORKTREE_PATH",
        type: "string",
        required: "set by webmux",
        description: "Absolute filesystem path to the managed worktree.",
      },
      {
        key: "WEBMUX_CONTROL_URL",
        type: "string",
        required: "managed panes",
        description: "Internal control endpoint used by the agent runtime event bridge.",
      },
      {
        key: "WEBMUX_CONTROL_TOKEN",
        type: "string",
        required: "managed panes",
        description: "Bearer token for authenticated control-plane event posts.",
      },
    ],
  },
];
