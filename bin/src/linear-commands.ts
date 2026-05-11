import { createApi, type PostWorktreeToLinearTarget } from "@webmux/api-contract";

class CommandUsageError extends Error {}

export interface ParsedLinearPostCommand {
  branch: string;
  target: PostWorktreeToLinearTarget;
  titleOverride: string | null;
}

export interface ParsedLinearCommand {
  subcommand: "post";
  post: ParsedLinearPostCommand;
}

export function getLinearUsage(): string {
  return [
    "Usage:",
    "  webmux linear post <branch> <issue-or-team> [--title <text>]",
    "",
    "Posts a worktree's conversation as a Linear attachment + summary comment.",
    "",
    "  <issue-or-team>  Either an existing issue id (e.g. ENG-123) to attach to,",
    "                   or a team key (e.g. ENG) to create a new issue first.",
    "  --title <text>   Override the auto-derived title when creating a new issue",
    "",
    "Examples:",
    "  webmux linear post feat/foo ENG-123",
    "  webmux linear post feat/foo ENG --title \"Investigate flaky test\"",
  ].join("\n");
}

function readOptionValue(args: string[], index: number, flag: string): { value: string; nextIndex: number } {
  const arg = args[index];
  if (!arg) throw new CommandUsageError(`${flag} requires a value`);
  const prefix = `${flag}=`;
  if (arg.startsWith(prefix)) return { value: arg.slice(prefix.length), nextIndex: index };
  const value = args[index + 1];
  if (value === undefined) throw new CommandUsageError(`${flag} requires a value`);
  return { value, nextIndex: index + 1 };
}

export function parseLinearTargetArg(raw: string): PostWorktreeToLinearTarget {
  const trimmed = raw.trim();
  if (/^[A-Z]+-\d+$/.test(trimmed)) {
    return { kind: "issue", issueId: trimmed };
  }
  if (/^[A-Z]+$/.test(trimmed)) {
    return { kind: "team", teamKey: trimmed };
  }
  throw new CommandUsageError(
    `Invalid Linear target "${trimmed}". Use an issue id (ENG-123) or a team key (ENG).`,
  );
}

export function parseLinearArgs(args: string[]): ParsedLinearCommand | null {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return null;
  }

  const subcommand = args[0];
  if (subcommand !== "post") {
    throw new CommandUsageError(`Unknown linear subcommand: ${subcommand}`);
  }

  let branch: string | null = null;
  let targetRaw: string | null = null;
  let titleOverride: string | null = null;

  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") return null;

    if (arg === "--title" || arg.startsWith("--title=")) {
      const { value, nextIndex } = readOptionValue(args, index, "--title");
      titleOverride = value;
      index = nextIndex;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new CommandUsageError(`Unknown option: ${arg}`);
    }

    if (!branch) {
      branch = arg;
      continue;
    }
    if (!targetRaw) {
      targetRaw = arg;
      continue;
    }
    throw new CommandUsageError(`Unexpected argument: ${arg}`);
  }

  if (!branch) throw new CommandUsageError("linear post requires a <branch> argument");
  if (!targetRaw) throw new CommandUsageError("linear post requires an <issue-or-team> argument");

  const baseTarget = parseLinearTargetArg(targetRaw);
  const target = baseTarget.kind === "team" && titleOverride
    ? { kind: "team" as const, teamKey: baseTarget.teamKey, title: titleOverride }
    : baseTarget;

  return {
    subcommand: "post",
    post: { branch, target, titleOverride },
  };
}

export async function runLinearCommand(args: string[], port: number): Promise<number> {
  let parsed: ParsedLinearCommand | null;
  try {
    parsed = parseLinearArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(getLinearUsage());
    return 1;
  }
  if (!parsed) {
    console.log(getLinearUsage());
    return 0;
  }

  const api = createApi(`http://localhost:${port}`);
  try {
    const response = await api.postWorktreeToLinear({
      params: { name: parsed.post.branch },
      body: { target: parsed.post.target },
    });
    console.log(`Posted to Linear issue: ${response.issueUrl}`);
    if (response.commentUrl) console.log(`Comment: ${response.commentUrl}`);
    console.log(`Attachment: ${response.attachmentUrl}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
