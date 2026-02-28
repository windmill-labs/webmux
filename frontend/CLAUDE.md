### Svelte 5 idioms

- **Use the Svelte MCP** for up-to-date docs and API usage when unsure about Svelte 5 patterns.
- Use runes exclusively: `$state`, `$derived`, `$effect`, `$props()`, `$bindable()`. No legacy `let` reactivity or stores.
- Prefer `$derived` over `$effect` for computed values — effects are for side-effects only.
- Use `{#snippet}` for reusable template fragments within a component.
- Use `{#key expr}` to force component remount when identity changes.

### TypeScript strictness

- `strict: true` — no exceptions.
- No `any`. No `as` casts unless narrowing from a validated external boundary. No `@ts-ignore` / `@ts-expect-error`.
- All component props must be typed via `$props<{ ... }>()`.
- API responses typed in `types.ts` — keep a single source of truth.
- Event callbacks typed explicitly (no inferred `Event` → always `MouseEvent`, `KeyboardEvent`, etc.).

### DRY and separation of concerns

- **Components**: UI rendering + user interaction. Minimal logic.
- **`lib/api.ts`**: All backend communication. Components never call `fetch` directly.
- **`lib/types.ts`**: All shared interfaces. No inline type definitions duplicated across files.
- Extract repeated UI patterns into components. Extract repeated logic into `lib/` utility functions.
- If a component exceeds ~300 lines, look for extraction opportunities.

### Styling

- Tailwind utility classes for layout and spacing.
- Use the theme CSS variables (`--color-*`) via Tailwind — never hardcode hex values.
- Responsive: mobile-first with `md:` breakpoint (768px) for desktop layout.
- Safe-area insets for mobile devices.

### Planning new features

- Define the data types first in `types.ts`.
- Define the API contract in `api.ts` (even if backend isn't built yet).
- Build the component with mock data, then wire up the API.
- Keep logic unit-testable: extract complex transformations/filters/sorts into pure functions in `lib/`.
- For new dialogs, follow the existing pattern: prop-driven visibility, callback on confirm, `<dialog>` element.
