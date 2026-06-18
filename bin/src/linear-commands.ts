import { createApi, parseLinearTarget, type PostWorktreeToLinearTarget } from "@webmux/api-contract";
import { CommandUsageError, formatServerError, resolveProjectBaseUrl } from "./shared";

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
    "  webmux linear post <branch> <team-key> [--title <text>]",
    "",
    "Creates a new Linear issue in <team-key> and posts the worktree's conversation",
    "as a JSON attachment + summary comment.",
    "",
    "  <team-key>       Linear team key (e.g. ENG). A new issue is created in that team.",
    "  --title <text>   Override the auto-derived title for the new issue",
    "",
    "To post into an existing issue, start the session with `webmux oneshot --linear",
    "<issue-id>` or `webmux add --from-linear <issue-id>` so the issue is the seed.",
    "",
    "Examples:",
    "  webmux linear post feat/foo ENG",
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
  const target = parseLinearTarget(raw);
  if (target.kind === "team") {
    return { kind: "team", teamKey: target.teamKey };
  }
  if (target.kind === "issue") {
    throw new CommandUsageError(
      `Post target must be a team key (e.g. ENG). To post to issue ${target.issueId} as part of a session, use --linear ${target.issueId} on the oneshot/add command (loads issue context and posts back to it).`,
    );
  }
  throw new CommandUsageError(
    `Invalid Linear team key "${target.raw}". Use a team key like ENG.`,
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
  if (!targetRaw) throw new CommandUsageError("linear post requires a <team-key> argument");

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

  try {
    const api = createApi(await resolveProjectBaseUrl(port));
    const response = await api.postWorktreeToLinear({
      params: { name: parsed.post.branch },
      body: { target: parsed.post.target },
    });
    console.log(`Posted to Linear issue: ${response.issueUrl}`);
    if (response.commentUrl) console.log(`Comment: ${response.commentUrl}`);
    console.log(`Attachment: ${response.attachmentUrl}`);
    return 0;
  } catch (error) {
    console.error(formatServerError(error, port));
    return 1;
  }
}
