# Claude Code: Session Continuation between CLI and Agents SDK

Continue a conversation started in the Claude Code CLI using the TypeScript or Python Agents SDK, and vice versa. Sessions are stored as JSONL files on disk and are fully interchangeable between surfaces.

## How sessions work

Every Claude Code conversation is persisted to:

```
~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
```

- `<encoded-cwd>` is the working directory with non-alphanumeric characters replaced by `-` (e.g. `/home/user/project` → `-home-user-project`)
- `<session-id>` is a UUID assigned when the session starts
- The file is plain JSONL — one JSON object per line containing user messages, assistant responses, tool calls, and metadata

Both the CLI (`claude`) and the Agents SDK (`@anthropic-ai/claude-agent-sdk`) read and write to the same files, making sessions fully portable between them.

## Getting a session ID

### From the CLI

Use `--output-format json` with print mode to get structured output:

```bash
echo "hello" | claude -p --output-format json
```

The response includes `session_id`:

```json
{
  "type": "result",
  "session_id": "93bc0449-4ff1-474a-bc36-876654f935c2",
  "result": "..."
}
```

In interactive mode, the session ID is shown in the UI and can also be retrieved via `--resume` (which lists recent sessions when called without an argument).

### From the SDK

The session ID is available on every `result` message:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const msg of query({ prompt: "hello", options: { cwd: "/tmp" } })) {
  if (msg.type === "result") {
    console.log(msg.session_id); // "93bc0449-..."
  }
}
```

## Reading session data (SDK)

### List sessions

```typescript
import { listSessions } from "@anthropic-ai/claude-agent-sdk";

const sessions = await listSessions({ dir: "/path/to/project", limit: 10 });
// [{ sessionId, summary, lastModified, fileSize, firstPrompt, gitBranch, cwd, createdAt }]
```

### Get session info

```typescript
import { getSessionInfo } from "@anthropic-ai/claude-agent-sdk";

const info = await getSessionInfo("93bc0449-...", { dir: "/tmp" });
// { sessionId, summary, lastModified, firstPrompt, gitBranch, cwd, createdAt, ... }
```

### Get session messages

```typescript
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";

const messages = await getSessionMessages("93bc0449-...", { dir: "/tmp" });
for (const m of messages) {
  console.log(m.message.role, m.message.content);
}
```

## Continuing a session

### CLI → SDK

Start a session in the CLI, then resume it from the SDK:

```bash
# 1. Start a session in the CLI
cd /tmp
echo "remember the code word is BANANA" | claude -p --output-format json
# → session_id: "93bc0449-..."
```

```typescript
// 2. Continue from the SDK
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const msg of query({
  prompt: "What was the code word?",
  options: {
    resume: "93bc0449-4ff1-474a-bc36-876654f935c2",
    cwd: "/tmp",
  },
})) {
  if (msg.type === "result") {
    console.log(msg.result); // "BANANA"
    console.log(msg.session_id === "93bc0449-..."); // true — same session
  }
}
```

### SDK → CLI

Start a session from the SDK, then resume it in the CLI:

```typescript
// 1. Start from the SDK
let sessionId: string;
for await (const msg of query({ prompt: "hello", options: { cwd: "/tmp" } })) {
  if (msg.type === "result") sessionId = msg.session_id;
}
```

```bash
# 2. Resume from the CLI
cd /tmp
claude -r "93bc0449-4ff1-474a-bc36-876654f935c2"
```

### Continue most recent session

Instead of passing a specific session ID, continue the most recent session in a directory:

```typescript
// SDK
query({ prompt: "follow up", options: { continue: true, cwd: "/tmp" } });
```

```bash
# CLI
claude -c
```

### Fork a session

Branch off a session into a new one (preserves the original):

```typescript
query({
  prompt: "try a different approach",
  options: {
    resume: "93bc0449-...",
    forkSession: true,
    cwd: "/tmp",
  },
});
```

```bash
claude -r "93bc0449-..." --fork-session
```

## Important constraints

- **`cwd` must match** — sessions are keyed by working directory. If you started a session in `/tmp`, you must resume with `cwd: "/tmp"`.
- **Sessions are local** — stored on the filesystem, not synced across machines. To transfer a session, copy the `.jsonl` file.
- **Git worktrees share sessions** — all worktrees in the same git repo share a single session directory.

## SDK packages

| Language   | Package                          |
| ---------- | -------------------------------- |
| TypeScript | `@anthropic-ai/claude-agent-sdk` |
| Python     | `claude-agent-sdk`               |

## Reference

- [CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-reference)
- [SDK sessions documentation](https://docs.anthropic.com/en/docs/claude-code/sdk/sessions)
