# Custom Agents and Multi-Agent Worktree Creation

## Goals

- Let users define their own agent alternatives in the frontend.
- Keep profiles focused on runtime, panes, env, and system prompt behavior.
- Replace the current single-agent-or-both model with true multi-agent selection.
- Allow worktree creation with one, two, three, or more selected agents.
- Keep CLI parity for using configured agents during worktree creation, without adding CLI agent-management commands.

## Product Decisions

### Agent management
- Users manage custom agents from the frontend only.
- No CLI commands for listing, creating, editing, or deleting agents.
- Custom agents are stored locally, not in shared project config by default.

### Multi-agent creation
- Remove the special `both` option.
- Users select one or more agents when creating a worktree.
- If one agent is selected, create one worktree on the requested branch.
- If multiple agents are selected, create one worktree per agent and prefix each branch with the agent id.

### Chat support
- Built-in agents keep existing chat behavior.
- Custom agents are terminal-only by default.
- UI should reflect capabilities instead of assuming all agents support in-app chat.

## UX Overview

### Settings
Add an Agents management surface in settings.

Each agent row should show:
- Label
- Built-in or custom badge
- Command preview
- Capability summary
- Actions such as edit, duplicate, delete, and test for custom agents

### Add/Edit custom agent form
Fields:
- Agent name
- Start command
- Resume command (optional)

Helper text should document supported placeholders:
- `${PROMPT}`
- `${SYSTEM_PROMPT}`
- `${WORKTREE_PATH}`
- `${REPO_PATH}`
- `${BRANCH}`
- `${PROFILE}`

Validation should cover:
- Required name
- Unique name/id
- Required start command
- Warning when the command does not use prompt placeholders

### Create Worktree dialog
Replace the fixed agent radio group with a dynamic multi-select list.

Each option should show:
- Checkbox
- Agent label
- Built-in/custom badge
- Capability badge, such as chat or terminal-only

Behavior:
- At least one agent must be selected
- Show selected count
- If multiple agents are selected, show a preview of the worktrees and prefixed branch names that will be created

### Worktree list and details
- Show the agent label instead of a hardcoded built-in name
- Hide or disable in-app chat actions for terminal-only agents
- Show clear messaging when an agent does not support chat/history/interrupt

## Architecture Overview

### Core model changes
Replace hardcoded built-in-only agent typing with registry-driven agent ids.

Recommended direction:
- Introduce `AgentId = string`
- Replace singular worktree creation agent selection with `agents: string[]`
- Store agent identity in metadata as `agentId`
- Expose both `agentId` and `agentLabel` to the frontend

### Agent registry
Introduce a backend registry that merges:
- Built-in agents
- Local custom agents from `.webmux.local.yaml`

The registry should be the source of truth for:
- Available agents
- Labels
- Capabilities
- Launch configuration

### Agent definitions
Each agent should have:
- Stable id
- Label
- Kind: built-in or custom
- Start command
- Optional resume command
- Capability flags

Built-in agents remain predefined definitions with special launch behavior and conversation support.
Custom agents use a generic command-based launcher and default to terminal-only capabilities.

### Launching
Introduce launcher abstractions so lifecycle code does not branch everywhere on specific agent names.

Suggested launcher types:
- Claude launcher
- Codex launcher
- Custom command launcher

This keeps special command generation logic isolated.

### Conversation support
Move to capability-driven behavior.

Built-ins:
- Claude and Codex continue using their existing adapters

Custom agents:
- No attach/history/send/interrupt support by default
- Only terminal launch support initially

## Persistence

### Local config
Persist custom agents in `.webmux.local.yaml`.

Suggested structure:

```yaml
agents:
  gemini:
    label: Gemini CLI
    startCommand: gemini --project . --prompt "${PROMPT}"
    resumeCommand: gemini resume --last
```

This keeps user-specific tools local by default.

## API Direction

### Frontend config payload
Extend app config with available agents and default agent id.

Each agent summary should expose:
- id
- label
- kind
- capability flags

### Agent management endpoints
Add backend endpoints for frontend CRUD and validation of custom agents.

Expected responsibilities:
- List agents
- Create custom agent
- Update custom agent
- Delete custom agent
- Validate or test command configuration

### Worktree creation contract
Change worktree creation input from a singular agent field to a plural agents field.

Behavior:
- Missing agents uses configured default
- Empty array is invalid
- One selected agent creates one worktree
- Multiple selected agents create one worktree per selected agent

## CLI Direction

CLI remains able to create worktrees with configured agents.

Supported behavior:
- Select a custom agent when creating a worktree
- Select multiple agents when creating a worktree

Out of scope:
- Managing custom agents from the CLI

## Migration Strategy

### Phase 1: model and backend foundations
- Introduce registry-based agent definitions
- Add local custom-agent persistence
- Replace `both` logic with generic multi-agent expansion
- Update worktree metadata and snapshots to use dynamic agent ids/labels

### Phase 2: frontend settings and creation UX
- Add Agents management UI
- Add add/edit/delete/test custom agent flows
- Replace agent radios with multi-select in create-worktree dialog
- Add multi-worktree branch preview

### Phase 3: CLI parity for usage
- Update CLI create command parsing to support multiple agents and custom ids
- Keep management frontend-only

### Phase 4: capability-driven polish
- Hide or disable unsupported chat actions for terminal-only agents
- Improve messaging around limited capabilities

## Non-Goals

- No CLI agent-management subcommands
- No attempt to make arbitrary custom agents support chat/history/interrupt in v1
- No speculative support for shared team-wide custom agents unless explicitly requested later
