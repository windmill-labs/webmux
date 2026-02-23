# Backend — Workmux

Stateless orchestration server managing Git worktrees, terminal sessions, and container port forwarding. Zero external dependencies beyond Bun's native APIs.

## Structure

```
backend/
└── src/
    ├── server.ts      # Bun.serve() HTTP/WebSocket entry point, REST routing
    ├── workmux.ts     # Git worktree lifecycle, workmux CLI wrapper
    ├── terminal.ts    # tmux session management, scrollback buffers, terminal I/O
    ├── socat.ts       # Docker container port forwarding via socat
    └── env.ts         # .env.local file parser for worktree environments
```

**No database. No ORM. No framework.** Pure `Bun.serve()` with in-memory `Map`-based session state.

### API surface

- `GET /api/worktrees` — list all worktrees with status
- `POST /api/worktrees` — create new worktree
- `DELETE /api/worktrees/:name` — remove worktree
- `POST /api/worktrees/:name/open` — open worktree
- `POST /api/worktrees/:name/merge` — merge worktree
- `GET /api/worktrees/:name/status` — worktree health
- `WS /ws/:worktree` — bidirectional terminal I/O (JSON protocol with `type` field)

### Key integrations

- **Process spawning**: `Bun.spawn()` / `Bun.spawnSync()` / `Bun.$` shell template literals
- **Terminal**: wraps `tmux` + `script` for session capture
- **Containers**: `docker inspect` for IPs, `socat` for port forwarding
- **Git**: `git worktree` commands for branch isolation

## Dev workflow

```sh
bun --watch src/server.ts   # dev (port 5111)
bun src/server.ts           # production
```

## Coding rules

### Bun-first

- Always use the latest Bun APIs. When in doubt, **search Bun docs** (`bun.sh/docs`) before reaching for Node.js patterns.
- Prefer `Bun.serve()`, `Bun.spawn()`, `Bun.$`, `Bun.file()`, `Bun.write()`, `Bun.sleep()`, `Bun.hash()` over Node equivalents.
- Use `Bun.env` for environment variables, not `process.env`.
- Use Bun's native test runner (`bun test`) when adding tests.

### TypeScript strictness

- `strict: true` in tsconfig — no exceptions.
- No `any`. No `as` casts unless narrowing from a validated boundary (e.g., JSON parse). No `@ts-ignore` / `@ts-expect-error`.
- Leverage library types fully. Use `Bun.serve`'s typed request/response, `Bun.spawn`'s `SpawnOptions`, etc.
- Prefer `satisfies` over `as` for type assertions where possible.
- Use discriminated unions for message types (e.g., WebSocket protocol).
- All function signatures must have explicit return types.

### Architecture

- One module = one concern. Keep the current flat `src/` structure — no deep nesting.
- Pure functions for logic, side-effectful functions clearly separated.
- New features should be unit-testable: extract business logic from I/O boundaries.
- Prefer returning `Result`-style objects (`{ ok: true, data } | { ok: false, error }`) over throwing for expected failures.

### Planning new features

- Define types/interfaces first, implement second.
- Identify the I/O boundary (HTTP handler, WebSocket message, CLI command) and keep it thin — delegate to typed, testable functions.
- If a feature touches multiple modules, plan the interface contract between them before coding.
- Write tests for pure logic. Mock I/O boundaries with typed stubs.
