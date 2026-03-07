## Implementing a new feature

Follow these steps in order. Do not skip ahead.

### 1. Understand the scope

Read the relevant CLAUDE.md before writing any code:

- **Backend work** → [`backend/CLAUDE.md`](backend/CLAUDE.md) — Bun APIs, REST/WebSocket conventions, module structure.
- **Frontend work** → [`frontend/CLAUDE.md`](frontend/CLAUDE.md) — Svelte 5 runes, component patterns, styling rules.
- **Full-stack feature** → Read both. Start with the backend.

### 2. Types first, code second

1. Define the data types/interfaces that the feature needs.
   - Backend types go in the relevant module file.
   - Frontend shared types go in `frontend/src/lib/types.ts` (types and interfaces only — no runtime logic).
2. Define the API contract — endpoint path, request body, response shape — before implementing either side.
3. On the frontend, add the typed fetch call to `frontend/src/lib/api.ts` before building UI.

### 3. Build incrementally

- **Backend**: implement the handler, delegate logic to pure testable functions, wire it into `server.ts` routing.
- **Frontend**: build the component with mock data first, then connect the real API.
- Test each layer independently before integrating.

### 4. DRY — no exceptions

- If a UI pattern already exists in another component, extract it into a shared component immediately. Do not copy-paste.
- If a helper function is needed in more than one file, put it in a shared `lib/` utility. Never duplicate logic across files.
- Check existing components and utilities before creating new ones.

### 5. Keep it minimal

- Only implement what was asked for. No speculative features, no extra configurability, no "while I'm here" refactors.
- Don't add comments, docstrings, or type annotations to code you didn't change.
- Don't add error handling for scenarios that can't happen. Trust internal code and framework guarantees.

## Debugging

When you are uncertain about the root cause of an issue, **add extensive debug logging before guessing at a fix**. This is mandatory, not optional.

### The rule

If you are not 100% sure where a bug comes from, do not propose a speculative fix. Instead:

1. **Add `console.log` / `console.debug` statements** at every relevant point in the code path — function entry/exit, variable values, branch decisions, API request/response payloads, WebSocket message contents.
2. **Log enough context** to pinpoint the problem: timestamps, identifiers (worktree name, session id), the actual values vs. what you expected.
3. **Run the code** with the logging in place and read the output.
4. **Only then** propose a fix based on what the logs reveal.
5. **Remove the debug logging** after the fix is confirmed.