# Step-by-Step Task Overview

## 1. Define the new agent model
- [x] Replace hardcoded built-in-only agent typing with a dynamic agent id model in the shared API contract.
- [x] Define shared types for agent summaries and capabilities.
- [x] Update frontend shared types to match the expanded API contract.
- [x] Add multi-agent request support to the shared create-worktree API contract while keeping the transitional single-agent field in place for now.
- [x] Extend config payloads with agent summaries and a default agent id.

## 2. Design the config and persistence layer
- [ ] Extend local config support in `.webmux.local.yaml` to persist custom agents.
- [ ] Decide the exact YAML shape for custom agent definitions.
- [ ] Add read/merge logic so built-ins and local custom agents appear as one registry.
- [ ] Add write/update/remove helpers for custom agents in the backend config adapter.

## 3. Introduce an agent registry in the backend
- Extend local config support in `.webmux.local.yaml` to persist custom agents.
- Decide the exact YAML shape for custom agent definitions.
- Add read/merge logic so built-ins and local custom agents appear as one registry.
- Add write/update/remove helpers for custom agents in the backend config adapter.

## 3. Introduce an agent registry in the backend
- Create a central registry/service that returns all available agents.
- Ensure built-in agents are always present.
- Prevent collisions with built-in ids.
- Make the registry the source of truth for labels, capabilities, and launch behavior.

## 4. Refactor launch logic around agent definitions
- Extract built-in launch behavior into dedicated launcher logic.
- Add a generic custom-command launcher.
- Support placeholder interpolation for custom commands.
- Keep resume behavior capability-driven.
- Remove scattered assumptions that only Claude and Codex can exist.

## 5. Refactor worktree creation for multiple agents
- Update backend worktree creation input to accept `agents: string[]`.
- Add validation for missing, empty, and unknown agent selections.
- Replace `both` expansion with generic multi-agent target expansion.
- Implement branch naming rules:
  - one selected agent => original branch
  - multiple selected agents => agent-prefixed branches
- Update creation progress/state handling to work for any number of agents.

## 6. Update worktree metadata and snapshots
- Store dynamic agent identity in worktree metadata.
- Expose both agent id and label in snapshot responses.
- Update reconciliation and runtime state logic to stop relying on a fixed agent union.
- Ensure existing worktree list/detail responses remain stable except for the new dynamic fields.

## 7. Make conversation features capability-driven
- Add capability checks for chat/history/interrupt support.
- Keep Claude and Codex wired to their existing adapters.
- Treat custom agents as terminal-only by default.
- Update backend endpoints to return clear errors or unsupported behavior when chat features are unavailable.

## 8. Extend frontend API contracts first
- Add typed frontend API methods for agent CRUD and validation/test flows.
- Extend app config fetching to include available agents and the default agent id.
- Update create-worktree request typing to send multiple selected agents.

## 9. Build the frontend agent-management UI
- Add an Agents section to settings or a dedicated management dialog.
- Show the list of built-in and custom agents.
- Implement add/edit/delete/duplicate/test actions for custom agents.
- Add form validation and placeholder help text.
- Make built-in agents visible but not editable/deletable.

## 10. Update the create-worktree dialog UX
- Replace fixed radio options with dynamic multi-select agent UI.
- Require at least one selected agent.
- Show selection count.
- Show capability badges.
- Show a multi-worktree branch preview when multiple agents are selected.
- Persist the preferred default selection locally if desired.

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
