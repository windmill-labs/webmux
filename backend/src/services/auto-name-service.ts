import type { AutoNameConfig } from "../domain/config";
import { isValidBranchName } from "../domain/policies";
import { generateFallbackBranchName } from "../lib/branch-name";
import { log } from "../lib/log";

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface SpawnOptions {
  timeoutMs?: number;
}

type SpawnLike = (args: string[], options?: SpawnOptions) => Promise<SpawnResult>;

const MAX_BRANCH_LENGTH = 40;
const DEFAULT_AUTO_NAME_MODEL = "claude-haiku-4-5-20251001";
const AUTO_NAME_TIMEOUT_MS = 10_000;

const DEFAULT_SYSTEM_PROMPT = [
  "Generate a concise git branch name from the task description.",
  "Return only the branch name.",
  "Use lowercase kebab-case.",
  `Maximum ${MAX_BRANCH_LENGTH} characters.`,
  "Do not include quotes, code fences, or prefixes like feature/ or fix/.",
].join(" ");

function normalizeGeneratedBranchName(raw: string): string {
  let branch = raw.trim();
  branch = branch.replace(/^```[\w-]*\s*/, "").replace(/\s*```$/, "");
  branch = branch.split(/\r?\n/)[0]?.trim() ?? "";
  branch = branch.replace(/^branch(?:\s+name)?\s*:\s*/i, "");
  branch = branch.replace(/^["'`]+|["'`]+$/g, "");
  branch = branch.toLowerCase();
  branch = branch.replace(/[^a-z0-9._/-]+/g, "-");
  branch = branch.replace(/[/.]+/g, "-");
  branch = branch.replace(/-+/g, "-");
  branch = branch.replace(/^-+|-+$/g, "");
  branch = branch.slice(0, MAX_BRANCH_LENGTH).replace(/-+$/, "");

  if (!branch) {
    throw new Error("Auto-name model returned an empty branch name");
  }
  if (!isValidBranchName(branch)) {
    throw new Error(`Auto-name model returned an invalid branch name: ${branch}`);
  }
  return branch;
}

function getSystemPrompt(config: AutoNameConfig): string {
  return config.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
}

class AutoNameTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Auto-name timed out after ${timeoutMs}ms`);
  }
}

async function defaultSpawn(args: string[], options: SpawnOptions = {}): Promise<SpawnResult> {
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const resultPromise = Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ exitCode, stdout, stderr }));

  if (options.timeoutMs === undefined) {
    return await resultPromise;
  }

  return await new Promise<SpawnResult>((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill("SIGKILL");
      } catch {}
      reject(new AutoNameTimeoutError(options.timeoutMs!));
    }, options.timeoutMs);

    void resultPromise.then((result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    }, (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

function buildClaudeArgs(model: string | undefined, systemPrompt: string, prompt: string): string[] {
  const args = [
    "claude",
    "-p",
    "--system-prompt", systemPrompt,
    "--output-format", "text",
    "--no-session-persistence",
    "--model", model || DEFAULT_AUTO_NAME_MODEL,
    "--effort", "low",
  ];
  args.push(prompt);
  return args;
}

function escapeTomlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function buildPrompt(prompt: string): string {
  return `Here is the task description: ${prompt}. You MUST return the branch name only, no other text or comments. Be fast, make it simple, and concise.`;
}

function buildCodexArgs(model: string | undefined, systemPrompt: string, prompt: string): string[] {
  const args = [
    "codex",
    "-c", `developer_instructions="${escapeTomlString(systemPrompt)}"`,
    "exec",
    "--ephemeral",
  ];
  if (model) {
    args.push("-m", model);
  }
  args.push(prompt);
  return args;
}

export interface AutoNameServiceDependencies {
  spawnImpl?: SpawnLike;
  timeoutMs?: number;
}

export interface AutoNameGenerator {
  generateBranchName(config: AutoNameConfig, task: string): Promise<string>;
}

export class AutoNameService implements AutoNameGenerator {
  private readonly spawnImpl: SpawnLike;
  private readonly timeoutMs: number;

  constructor(deps: AutoNameServiceDependencies = {}) {
    this.spawnImpl = deps.spawnImpl ?? defaultSpawn;
    this.timeoutMs = deps.timeoutMs ?? AUTO_NAME_TIMEOUT_MS;
  }

  async generateBranchName(config: AutoNameConfig, task: string): Promise<string> {
    const prompt = task.trim();
    if (!prompt) {
      throw new Error("Auto-name requires a prompt");
    }

    const systemPrompt = getSystemPrompt(config);
    const userPrompt = buildPrompt(prompt);

    const args = config.provider === "claude"
      ? buildClaudeArgs(config.model, systemPrompt, userPrompt)
      : buildCodexArgs(config.model, systemPrompt, userPrompt);

    const cli = config.provider === "claude" ? "claude" : "codex";

    let result: SpawnResult;
    try {
      result = await this.spawnImpl(args, { timeoutMs: this.timeoutMs });
    } catch (error) {
      if (error instanceof AutoNameTimeoutError) {
        const fallback = generateFallbackBranchName();
        log.warn(`[auto-name] ${cli} timed out after ${this.timeoutMs}ms; using fallback branch ${fallback}`);
        return fallback;
      }
      throw new Error(`'${cli}' CLI not found. Install it or check your PATH.`);
    }

    if (result.exitCode !== 0) {
      const stderr = result.stderr.trim();
      const stdout = result.stdout.trim();
      const output = stderr || stdout || `exit ${result.exitCode}`;
      const command = args.join(" ");
      throw new Error(`${cli} failed (command: ${command}): ${output}`);
    }

    const output = result.stdout.trim();
    if (!output) {
      throw new Error(`${cli} returned empty output`);
    }

    return normalizeGeneratedBranchName(output);
  }
}
