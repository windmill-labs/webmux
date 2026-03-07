import type { AutoNameConfig } from "../domain/config";
import { isValidBranchName } from "../domain/policies";

type AutoNameProvider = "anthropic" | "google" | "openai";

interface ResolvedAutoNameModel {
  provider: AutoNameProvider;
  model: string;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const BRANCH_NAME_SCHEMA = {
  type: "object",
  properties: {
    branch_name: {
      type: "string",
      description: "A lowercase kebab-case git branch name with no prefix",
    },
  },
  required: ["branch_name"],
  additionalProperties: false,
} as const;

const GEMINI_BRANCH_NAME_SCHEMA = {
  ...BRANCH_NAME_SCHEMA,
  propertyOrdering: ["branch_name"],
} as const;

const DEFAULT_SYSTEM_PROMPT = [
  "Generate a concise git branch name from the task description.",
  "Return only the branch name.",
  "Use lowercase kebab-case.",
  "Do not include quotes, code fences, or prefixes like feature/ or fix/.",
].join(" ");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildPrompt(task: string): string {
  return `Task description:\n${task.trim()}`;
}

function parseBranchNamePayload(raw: unknown): string {
  if (!isRecord(raw) || typeof raw.branch_name !== "string") {
    throw new Error("Auto-name response did not include branch_name");
  }
  return raw.branch_name;
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Auto-name response was not valid JSON: ${text}`);
  }
}

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

  if (!branch) {
    throw new Error("Auto-name model returned an empty branch name");
  }
  if (!isValidBranchName(branch)) {
    throw new Error(`Auto-name model returned an invalid branch name: ${branch}`);
  }
  return branch;
}

function resolveAutoNameModel(modelSpec: string): ResolvedAutoNameModel {
  const trimmed = modelSpec.trim();
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex > 0) {
    const provider = trimmed.slice(0, slashIndex);
    const model = trimmed.slice(slashIndex + 1).trim().replace(/^models\//, "");
    if (!model) {
      throw new Error(`Invalid auto_name model: ${modelSpec}`);
    }
    if (provider === "anthropic" || provider === "google" || provider === "openai") {
      return { provider, model };
    }
    if (provider === "gemini") {
      return { provider: "google", model };
    }
  }

  if (trimmed.startsWith("claude-")) {
    return { provider: "anthropic", model: trimmed };
  }
  if (trimmed.startsWith("gemini-") || trimmed.startsWith("models/gemini-")) {
    return { provider: "google", model: trimmed.replace(/^models\//, "") };
  }
  if (/^(gpt-|chatgpt-|o\d)/.test(trimmed)) {
    return { provider: "openai", model: trimmed };
  }

  throw new Error(
    `Unsupported auto_name model provider for ${modelSpec}. Use an anthropic/, gemini/, google/, or openai/ prefix, or a known model name.`,
  );
}

function getSystemPrompt(config: AutoNameConfig): string {
  return config.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
}

function extractAnthropicText(raw: unknown): string | null {
  if (!isRecord(raw) || !Array.isArray(raw.content)) return null;
  for (const item of raw.content) {
    if (!isRecord(item)) continue;
    if (item.type === "text" && typeof item.text === "string" && item.text.trim()) {
      return item.text;
    }
  }
  return null;
}

function extractGoogleText(raw: unknown): string | null {
  if (!isRecord(raw) || !Array.isArray(raw.candidates)) return null;
  for (const candidate of raw.candidates) {
    if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) continue;
    for (const part of candidate.content.parts) {
      if (isRecord(part) && typeof part.text === "string" && part.text.trim()) {
        return part.text;
      }
    }
  }
  return null;
}

function extractOpenAiText(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.output_text === "string" && raw.output_text.trim()) {
    return raw.output_text;
  }
  if (!Array.isArray(raw.output)) return null;
  for (const item of raw.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isRecord(content)) continue;
      if (typeof content.text === "string" && content.text.trim()) {
        return content.text;
      }
    }
  }
  return null;
}

async function readErrorBody(response: Response): Promise<string> {
  const text = (await response.text()).trim();
  return text || `HTTP ${response.status}`;
}

export interface AutoNameServiceDependencies {
  fetchImpl?: FetchLike;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  openaiApiKey?: string;
}

export interface AutoNameGenerator {
  generateBranchName(config: AutoNameConfig, task: string): Promise<string>;
}

export class AutoNameService implements AutoNameGenerator {
  private readonly fetchImpl: FetchLike;
  private readonly anthropicApiKey: string | undefined;
  private readonly geminiApiKey: string | undefined;
  private readonly openaiApiKey: string | undefined;

  constructor(deps: AutoNameServiceDependencies = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.anthropicApiKey = deps.anthropicApiKey ?? Bun.env.ANTHROPIC_API_KEY;
    this.geminiApiKey = deps.geminiApiKey ?? Bun.env.GEMINI_API_KEY;
    this.openaiApiKey = deps.openaiApiKey ?? Bun.env.OPENAI_API_KEY;
  }

  async generateBranchName(config: AutoNameConfig, task: string): Promise<string> {
    const prompt = task.trim();
    if (!prompt) {
      throw new Error("Auto-name requires a prompt");
    }

    const resolved = resolveAutoNameModel(config.model);
    const branchName = resolved.provider === "anthropic"
      ? await this.generateWithAnthropic(resolved.model, getSystemPrompt(config), prompt)
      : resolved.provider === "google"
      ? await this.generateWithGoogle(resolved.model, getSystemPrompt(config), prompt)
      : await this.generateWithOpenAI(resolved.model, getSystemPrompt(config), prompt);

    return normalizeGeneratedBranchName(branchName);
  }

  private async generateWithAnthropic(model: string, systemPrompt: string, task: string): Promise<string> {
    if (!this.anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY is required for auto_name with Anthropic models");
    }

    const response = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        max_tokens: 64,
        messages: [{ role: "user", content: buildPrompt(task) }],
        output_config: {
          format: {
            type: "json_schema",
            schema: BRANCH_NAME_SCHEMA,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic auto-name request failed: ${await readErrorBody(response)}`);
    }

    const json: unknown = await response.json();
    if (isRecord(json) && json.stop_reason === "refusal") {
      throw new Error("Anthropic auto-name request was refused");
    }
    if (isRecord(json) && json.stop_reason === "max_tokens") {
      throw new Error("Anthropic auto-name response hit max_tokens before completing");
    }
    const text = extractAnthropicText(json);
    if (!text) {
      throw new Error("Anthropic auto-name response did not include text");
    }
    return parseBranchNamePayload(parseJsonText(text));
  }

  private async generateWithGoogle(model: string, systemPrompt: string, task: string): Promise<string> {
    if (!this.geminiApiKey) {
      throw new Error("GEMINI_API_KEY is required for auto_name with Gemini models");
    }

    const response = await this.fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.geminiApiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: buildPrompt(task) }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: GEMINI_BRANCH_NAME_SCHEMA,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Google auto-name request failed: ${await readErrorBody(response)}`);
    }

    const json: unknown = await response.json();
    const text = extractGoogleText(json);
    if (!text) {
      throw new Error("Google auto-name response did not include text");
    }
    return parseBranchNamePayload(parseJsonText(text));
  }

  private async generateWithOpenAI(model: string, systemPrompt: string, task: string): Promise<string> {
    if (!this.openaiApiKey) {
      throw new Error("OPENAI_API_KEY is required for auto_name with OpenAI models");
    }

    const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.openaiApiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: buildPrompt(task) },
        ],
        max_output_tokens: 64,
        text: {
          format: {
            type: "json_schema",
            name: "branch_name_response",
            strict: true,
            schema: BRANCH_NAME_SCHEMA,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI auto-name request failed: ${await readErrorBody(response)}`);
    }

    const json: unknown = await response.json();
    if (isRecord(json) && Array.isArray(json.output)) {
      for (const item of json.output) {
        if (!isRecord(item) || !Array.isArray(item.content)) continue;
        for (const content of item.content) {
          if (isRecord(content) && content.type === "refusal" && typeof content.refusal === "string") {
            throw new Error(`OpenAI auto-name request was refused: ${content.refusal}`);
          }
        }
      }
    }
    const text = extractOpenAiText(json);
    if (!text) {
      throw new Error("OpenAI auto-name response did not include text");
    }
    return parseBranchNamePayload(parseJsonText(text));
  }
}
