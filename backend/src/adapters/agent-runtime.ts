import { chmod, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getWorktreeStoragePaths } from "./fs";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildAgentCtlScript(): string {
  return `#!/usr/bin/env python3
import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path


CONTROL_ENV_PATH = Path(__file__).resolve().with_name("control.env")


def read_control_env():
    env = {}
    try:
        content = CONTROL_ENV_PATH.read_text()
    except OSError as error:
        raise RuntimeError(f"failed to read control.env: {error}") from error

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if len(value) >= 2 and value.startswith("'") and value.endswith("'"):
            value = value[1:-1].replace("'\\\\''", "'")
        env[key] = value

    return env


def build_parser():
    parser = argparse.ArgumentParser(prog="webmux-agentctl")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("agent-started")
    subparsers.add_parser("agent-stopped")

    title_changed = subparsers.add_parser("title-changed")
    title_changed.add_argument("--title", required=True)

    pr_opened = subparsers.add_parser("pr-opened")
    pr_opened.add_argument("--url")

    runtime_error = subparsers.add_parser("runtime-error")
    runtime_error.add_argument("--message", required=True)

    return parser


def build_payload(command, args, control_env):
    payload = {
        "worktreeId": control_env["WEBMUX_WORKTREE_ID"],
        "branch": control_env["WEBMUX_BRANCH"],
    }

    if command == "agent-started":
        payload["type"] = "agent_started"
        return payload
    if command == "agent-stopped":
        payload["type"] = "agent_stopped"
        return payload
    if command == "title-changed":
        payload["type"] = "title_changed"
        payload["title"] = args.title
        return payload
    if command == "pr-opened":
        payload["type"] = "pr_opened"
        if args.url:
            payload["url"] = args.url
        return payload
    if command == "runtime-error":
        payload["type"] = "runtime_error"
        payload["message"] = args.message
        return payload
    raise RuntimeError(f"unsupported command: {command}")


def main():
    parsed = build_parser().parse_args()

    try:
        control_env = read_control_env()
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 1

    required_keys = [
        "WEBMUX_CONTROL_URL",
        "WEBMUX_CONTROL_TOKEN",
        "WEBMUX_WORKTREE_ID",
        "WEBMUX_BRANCH",
    ]
    missing = [key for key in required_keys if not control_env.get(key)]
    if missing:
        print(f"missing control env keys: {', '.join(missing)}", file=sys.stderr)
        return 1

    payload = build_payload(parsed.command, parsed, control_env)
    request = urllib.request.Request(
        control_env["WEBMUX_CONTROL_URL"],
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {control_env['WEBMUX_CONTROL_TOKEN']}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            if response.status < 200 or response.status >= 300:
                print(f"control endpoint returned HTTP {response.status}", file=sys.stderr)
                return 1
    except urllib.error.HTTPError as error:
        print(f"control endpoint returned HTTP {error.code}", file=sys.stderr)
        return 1
    except Exception as error:
        print(f"failed to send runtime event: {error}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
`;
}

function buildStopHookScript(): string {
  return `#!/usr/bin/env python3
import subprocess
import sys
from pathlib import Path


def main():
    _ = sys.stdin.read()
    agentctl = Path(__file__).resolve().parent.parent / "webmux-agentctl"
    subprocess.run(
        [str(agentctl), "agent-stopped"],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
`;
}

function buildPostToolUseHookScript(): string {
  return `#!/usr/bin/env python3
import json
import re
import subprocess
import sys
from pathlib import Path


PR_URL_PATTERN = re.compile(r"https://github\\.com/[^\\s\\\"]+/pull/\\d+")


def main():
    raw = sys.stdin.read()
    if not raw.strip():
        return 0

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return 0

    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return 0

    command = tool_input.get("command")
    if not isinstance(command, str) or "gh pr create" not in command:
        return 0

    args = [str(Path(__file__).resolve().parent.parent / "webmux-agentctl"), "pr-opened"]
    tool_response = payload.get("tool_response")
    if isinstance(tool_response, str):
        match = PR_URL_PATTERN.search(tool_response)
        if match:
            args.extend(["--url", match.group(0)])

    subprocess.run(
        args,
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
`;
}

export interface AgentRuntimeArtifacts {
  agentCtlPath: string;
  stopHookPath: string;
  postToolUseHookPath: string;
  claudeSettingsPath: string;
}

function buildClaudeHookSettings(input: AgentRuntimeArtifacts): Record<string, unknown> {
  return {
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: shellQuote(input.stopHookPath),
              async: true,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: shellQuote(input.postToolUseHookPath),
              async: true,
            },
          ],
        },
      ],
    },
  };
}

async function mergeClaudeSettings(
  settingsPath: string,
  hookSettings: Record<string, unknown>,
): Promise<void> {
  let existing: Record<string, unknown> = {};

  try {
    const file = Bun.file(settingsPath);
    if (await file.exists()) {
      const parsed = await file.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    }
  } catch {
    existing = {};
  }

  const existingHooks = existing.hooks;
  const mergedHooks = existingHooks && typeof existingHooks === "object" && !Array.isArray(existingHooks)
    ? { ...existingHooks, ...hookSettings }
    : hookSettings;
  const merged = { ...existing, hooks: mergedHooks };
  await Bun.write(settingsPath, JSON.stringify(merged, null, 2) + "\n");
}

export async function ensureAgentRuntimeArtifacts(input: {
  gitDir: string;
  worktreePath: string;
}): Promise<AgentRuntimeArtifacts> {
  const storagePaths = getWorktreeStoragePaths(input.gitDir);
  const hooksDir = join(storagePaths.webmuxDir, "hooks");
  const artifacts: AgentRuntimeArtifacts = {
    agentCtlPath: join(storagePaths.webmuxDir, "webmux-agentctl"),
    stopHookPath: join(hooksDir, "claude-stop-hook"),
    postToolUseHookPath: join(hooksDir, "claude-post-tool-use-hook"),
    claudeSettingsPath: join(input.worktreePath, ".claude", "settings.local.json"),
  };

  await mkdir(hooksDir, { recursive: true });
  await mkdir(dirname(artifacts.claudeSettingsPath), { recursive: true });

  await Bun.write(artifacts.agentCtlPath, buildAgentCtlScript());
  await Bun.write(artifacts.stopHookPath, buildStopHookScript());
  await Bun.write(artifacts.postToolUseHookPath, buildPostToolUseHookScript());
  await chmod(artifacts.agentCtlPath, 0o755);
  await chmod(artifacts.stopHookPath, 0o755);
  await chmod(artifacts.postToolUseHookPath, 0o755);

  const hookSettings = buildClaudeHookSettings(artifacts);
  const hooks = hookSettings.hooks;
  if (!isRecord(hooks)) {
    throw new Error("Invalid Claude hook settings");
  }
  await mergeClaudeSettings(artifacts.claudeSettingsPath, hooks);

  return artifacts;
}
