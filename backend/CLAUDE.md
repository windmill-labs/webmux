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
