import { dirname, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { createApi } from "@webmux/api-contract";
import { run } from "../../backend/src/lib/shell";

// Generic process/git/repo primitives live in the backend lib so backend code
// (e.g. project setup) can share them; re-export here so existing CLI imports
// from "./shared" keep working.
export { run, which, getGitRoot, detectProjectName, type RunResult } from "../../backend/src/lib/shell";

/**
 * Thrown by argparse functions to signal usage errors (e.g. missing flag value,
 * unknown option). Caught at the command entry point so the CLI can print the
 * help banner alongside the message.
 */
export class CommandUsageError extends Error {}

/**
 * When the webmux server isn't reachable the bare error message is unhelpful to
 * users. Older Bun threw a `TypeError: fetch failed`; current Bun throws
 * "Unable to connect. Is the computer able to access the url?" (code
 * ConnectionRefused). This returns a friendly "Is the server running?" hint for
 * either case and leaves HTTP/other errors untouched.
 */
export function formatServerError(error: unknown, port: number): string {
  if (error instanceof Error) {
    if (error.message.startsWith("HTTP")) return error.message;
    if (error.message.includes("fetch") || error.message.includes("Unable to connect")) {
      return `Could not connect to webmux server on port ${port}. Is it running?`;
    }
    return error.message;
  }
  return String(error);
}

export async function withServerConnection<T>(port: number, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new Error(formatServerError(error, port));
  }
}

/** Resolve a directory to its canonical project (git) root — the shared root
 *  even from a linked worktree — matching the server's `projectRoot()`. Returns
 *  null when the dir isn't a git work tree (or git is unavailable). */
export function resolveProjectRoot(cwd: string = process.cwd()): string | null {
  try {
    const common = run("git", ["rev-parse", "--git-common-dir"], { cwd });
    if (common.success) {
      const commonDir = common.stdout.toString().trim();
      if (commonDir) return dirname(resolve(cwd, commonDir));
    }
    const top = run("git", ["rev-parse", "--show-toplevel"], { cwd });
    return top.success ? top.stdout.toString().trim() : null;
  } catch {
    return null;
  }
}

/** Canonicalize a filesystem path for equality comparison: collapse symlinks,
 *  trailing slashes, and `.`/`..` segments. The server stores each project's git
 *  root via its own `projectRoot()`, which is `resolve`-based and does not follow
 *  symlinks — so a CLI invoked from a symlinked cwd (or with a trailing slash)
 *  could compute a different-but-equivalent string. Realpathing both sides at
 *  compare time makes the match robust; falls back to `resolve` if the path is
 *  gone (it normally exists, since the server is local). */
function canonicalizePath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** Base URL for talking to the active project on the running server. The server
 *  serves each project under `/<prefix>`, so a server-backed CLI command must
 *  target `http://localhost:<port>/<prefix>` for the project at `projectDir`.
 *  Throws a CommandUsageError when `projectDir` isn't a git repo (no project to
 *  scope to) or when its root resolves but isn't a served project. */
export async function resolveProjectBaseUrl(port: number, projectDir: string = process.cwd()): Promise<string> {
  const base = `http://localhost:${port}`;
  const root = resolveProjectRoot(projectDir);
  if (!root) {
    throw new CommandUsageError(
      `Not inside a git repository, so webmux can't tell which project this command targets. cd into a project served by webmux (\`webmux project ls\` lists them) and try again.`,
    );
  }
  const { projects } = await createApi(base).fetchProjects();
  const target = canonicalizePath(root);
  const match = projects.find((project) => canonicalizePath(project.path) === target);
  if (!match) {
    throw new CommandUsageError(
      `This project (${root}) isn't served by webmux on port ${port}. Run \`webmux project add\` or start \`webmux serve\` in it first.`,
    );
  }
  return `${base}/${match.prefix}`;
}

/** The server serves each project under `/<prefix>`, so an in-process runtime
 *  that writes `control.env` must embed that prefix or the agent's status hooks
 *  POST to an unrouted path. Best-effort: returns `undefined` when the prefix
 *  can't be resolved (no server running, or the repo isn't a served project) so
 *  the caller writes no control URL at all rather than a wrong one. Status
 *  self-heals when the worktree is next opened/refreshed from a dashboard. */
export async function resolveProjectPrefix(port: number, projectDir: string = process.cwd()): Promise<string | undefined> {
  try {
    const base = await resolveProjectBaseUrl(port, projectDir);
    return new URL(base).pathname.replace(/^\/+|\/+$/g, "") || undefined;
  } catch {
    return undefined;
  }
}
