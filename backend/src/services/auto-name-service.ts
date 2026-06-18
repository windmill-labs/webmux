import type { AutoNameConfig } from "../domain/config";
import { isValidBranchName } from "../domain/policies";
import { generateFallbackBranchName } from "../lib/branch-name";
import { log } from "../lib/log";
import { llmProviderLabel, runShortLlmTask, type RunLlmOptions, type SpawnLike } from "./llm-spawn";

const MAX_BRANCH_LENGTH = 40;
const AUTO_NAME_TIMEOUT_MS = 15_000;

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

function buildPrompt(prompt: string): string {
  return `Here is the task description: ${prompt}. You MUST return the branch name only, no other text or comments. Be fast, make it simple, and concise.`;
}

export interface AutoNameServiceDependencies {
  spawnImpl?: SpawnLike;
  timeoutMs?: number;
}

export interface AutoNameGenerator {
  generateBranchName(config: AutoNameConfig, task: string): Promise<string>;
}

export class AutoNameService implements AutoNameGenerator {
  private readonly spawnImpl: SpawnLike | undefined;
  private readonly timeoutMs: number;

  constructor(deps: AutoNameServiceDependencies = {}) {
    this.spawnImpl = deps.spawnImpl;
    this.timeoutMs = deps.timeoutMs ?? AUTO_NAME_TIMEOUT_MS;
  }

  async generateBranchName(config: AutoNameConfig, task: string): Promise<string> {
    const prompt = task.trim();
    if (!prompt) {
      throw new Error("Auto-name requires a prompt");
    }

    const systemPrompt = getSystemPrompt(config);
    const userPrompt = buildPrompt(prompt);
    const cli = llmProviderLabel(config);

    const runOptions: RunLlmOptions = { timeoutMs: this.timeoutMs };
    if (this.spawnImpl) runOptions.spawnImpl = this.spawnImpl;
    const result = await runShortLlmTask(config, systemPrompt, userPrompt, runOptions);

    if (!result.ok) {
      if (result.kind === "timeout") {
        const fallback = generateFallbackBranchName();
        log.warn(`[auto-name] ${cli} timed out after ${this.timeoutMs}ms; using fallback branch ${fallback}`);
        return fallback;
      }
      if (result.kind === "spawn_error") {
        throw new Error(`'${cli}' CLI not found. Install it or check your PATH.`);
      }
      const stderr = result.stderr.trim();
      const stdout = result.stdout.trim();
      const output = stderr || stdout || `exit ${result.exitCode}`;
      const command = result.args.join(" ");
      throw new Error(`${cli} failed (command: ${command}): ${output}`);
    }

    const output = result.stdout.trim();
    if (!output) {
      throw new Error(`${cli} returned empty output`);
    }

    return normalizeGeneratedBranchName(output);
  }
}
