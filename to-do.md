# Step-by-Step Task Overview

## 1. Define the new agent model
- [x] Replace hardcoded built-in-only agent typing with a dynamic agent id model in the shared API contract.
- [x] Define shared types for agent summaries and capabilities.
- [x] Update frontend shared types to match the expanded API contract.
- [x] Add multi-agent request support to the shared create-worktree API contract while keeping the transitional single-agent field in place for now.
- [x] Extend config payloads with agent summaries and a default agent id.

## 2. Design the config and persistence layer
- [x] Extend local config support in `.webmux.local.yaml` to persist custom agents.
- [x] Set the local YAML shape to `agents.<id>.{label,startCommand,resumeCommand?}`.
- [x] Add read/merge logic so custom agents load into the project config.
- [x] Add write/remove helpers for custom agents in the backend config adapter.

## 3. Introduce an agent registry in the backend
- [x] Create a central registry/service that returns all available agents.
- [x] Ensure built-in agents are always present.
- [x] Prevent collisions with built-in ids.
- [x] Make the registry the source of truth for labels, capabilities, and launch behavior.

## 4. Refactor launch logic around agent definitions
- [x] Extract built-in launch behavior into dedicated launcher logic.
- [x] Add a generic custom-command launcher.
- [x] Support placeholder interpolation for custom commands.
- [x] Keep resume behavior capability-driven.
- [x] Update the lifecycle launch path so it resolves agents through definitions instead of hardcoded built-in checks.

## 5. Refactor worktree creation for multiple agents
- [x] Update backend worktree creation input to accept `agents: string[]`.
- [x] Add validation for missing, empty, and unknown agent selections.
- [x] Replace `both` expansion with generic multi-agent target expansion.
- [x] Implement branch naming rules:
  - [x] one selected agent => original branch
  - [x] multiple selected agents => agent-prefixed branches
- [x] Update creation progress/state handling to work for any number of agents.

## 6. Update worktree metadata and snapshots
- [x] Store dynamic agent identity in worktree metadata.
- [ ] Expose both agent id and label in snapshot responses.
- [x] Update reconciliation and runtime state logic to stop relying on a fixed agent union.
- [ ] Ensure existing worktree list/detail responses remain stable except for the new dynamic fields.

## 7. Make conversation features capability-driven
- Add capability checks for chat/history/interrupt support.
- Keep Claude and Codex wired to their existing adapters.
- Treat custom agents as terminal-only by default.
- Update backend endpoints to return clear errors or unsupported behavior when chat features are unavailable.

## 8. Extend frontend API contracts first
- [ ] Add typed frontend API methods for agent CRUD and validation/test flows.
- [x] Extend app config fetching to include available agents and the default agent id.
- [x] Update create-worktree request typing to send multiple selected agents.

## 9. Build the frontend agent-management UI
- [x] Add an Agents section to settings or a dedicated management dialog.
- [x] Show the list of built-in and custom agents.
- [ ] Implement add/edit/delete/duplicate/test actions for custom agents.
  - [x] add
  - [x] edit
  - [x] delete
  - [x] duplicate
  - [ ] test
- [x] Add form validation and placeholder help text.
- [x] Make built-in agents visible but not editable/deletable.

## 10. Update the create-worktree dialog UX
- [x] Replace fixed radio options with dynamic multi-select agent UI.
- [x] Require at least one selected agent.
- [x] Show selection count.
- [x] Show capability badges.
- [x] Show a multi-worktree branch preview when multiple agents are selected.
- [x] Persist the preferred default selection locally if desired.

## 11. Update worktree list and detail UI
- Display agent labels from the backend instead of hardcoded names.
- Hide or disable chat affordances for terminal-only agents.
- Add clear UI messaging when a selected or running agent does not support in-app chat.

## 12. Update CLI worktree creation support
- Keep CLI management out of scope.
- Update CLI create/add parsing to accept multiple agents.
- Validate agent ids through the backend/runtime config path.
- Ensure custom configured agents can be used from CLI worktree creation.
- Update help text and tests accordingly.

## 13. Add backend tests
- Registry tests
- Config read/write tests for custom agents
- Multi-agent target expansion tests
- Launch command generation tests for custom agents
- Validation tests for unknown/duplicate/invalid agents
- Conversation capability tests for unsupported agents

## 14. Add frontend tests
- Settings agent-management flows
- Create-worktree multi-select behavior
- Branch preview behavior
- Capability-driven chat visibility
- API integration typing and state transitions

## 15. Add CLI tests
- Parsing repeated or multiple agent selections
- Validation behavior for invalid agent ids
- Successful multi-agent worktree creation inputs

## 16. Roll out incrementally
- First land types and contracts.
- Then backend registry and persistence.
- Then multi-agent creation logic.
- Then frontend management UI.
- Then CLI usage support.
- Finally polish capability-based UX and remove legacy `both` handling everywhere.
