import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildInitAgentCommand,
  buildInitPromptSpec,
  buildStarterTemplate,
  detectInitProjectContext,
  parseInitAgentStreamLine,
} from "./init-helpers.ts";

describe("buildInitAgentCommand", () => {
  const prompt = {
    systemPrompt: "system",
    userPrompt: "user",
  };

  it("builds the Claude non-interactive command", () => {
    expect(buildInitAgentCommand("claude", prompt)).toEqual({
      agent: "claude",
      cmd: "claude",
      args: [
        "-p",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
        "--model",
        "haiku",
        "--effort",
        "low",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--append-system-prompt",
        "system",
        "user",
      ],
    });
  });

  it("builds the Codex non-interactive command with a summary path", () => {
    const command = buildInitAgentCommand("codex", prompt, "test-init");

    expect(command.agent).toBe("codex");
    expect(command.cmd).toBe("codex");
    expect(command.summaryPath).toContain("test-init-");
    expect(command.args).toContain("exec");
    expect(command.args).toContain("--json");
    expect(command.args).toContain("--sandbox");
    expect(command.args).toContain("workspace-write");
    expect(command.args).toContain("-m");
    expect(command.args).toContain("gpt-5.1-codex");
    expect(command.args).toContain("-o");
    expect(command.args).toContain("-c");
    expect(command.args).toContain('model_reasoning_effort="low"');
    expect(command.args).toContain("developer_instructions=system");
    expect(command.args.at(-1)).toBe("user");
  });
});

describe("parseInitAgentStreamLine", () => {
  it("streams Claude text deltas and tool statuses", () => {
    const state = { assistantSnapshot: "", lastStatus: null };

    expect(
      parseInitAgentStreamLine(
        "claude",
        JSON.stringify({
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hello" },
        }),
        state,
      ),
    ).toEqual([{ kind: "assistant_delta", text: "Hello" }]);

    expect(
      parseInitAgentStreamLine(
        "claude",
        JSON.stringify({
          type: "content_block_start",
          content_block: { type: "tool_use", name: "Read" },
        }),
        state,
      ),
    ).toEqual([{ kind: "status", text: "Using Read..." }]);
  });

  it("streams Codex deltas and command statuses", () => {
    const state = { assistantSnapshot: "", lastStatus: null };

    expect(
      parseInitAgentStreamLine(
        "codex",
        JSON.stringify({
          type: "response.output_text.delta",
          delta: "Hello",
        }),
        state,
      ),
    ).toEqual([{ kind: "assistant_delta", text: "Hello" }]);

    expect(
      parseInitAgentStreamLine(
        "codex",
        JSON.stringify({
          type: "exec.command.started",
          command: ["rg", "PORT"],
        }),
        state,
      ),
    ).toEqual([{ kind: "status", text: "Running rg PORT" }]);
  });

  it("emits only the new suffix for snapshot-style assistant payloads", () => {
    const state = { assistantSnapshot: "", lastStatus: null };

    expect(
      parseInitAgentStreamLine(
        "claude",
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Hello" }],
          },
        }),
        state,
      ),
    ).toEqual([{ kind: "assistant_delta", text: "Hello" }]);

    expect(
      parseInitAgentStreamLine(
        "claude",
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Hello world" }],
          },
        }),
        state,
      ),
    ).toEqual([{ kind: "assistant_delta", text: " world" }]);
  });
});

describe("detectInitProjectContext", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("detects the basic starter-template metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "webmux-init-helpers-"));
    tempDirs.push(dir);

    Bun.spawnSync(["git", "init", "-b", "main"], { cwd: dir });
    await Bun.write(join(dir, "bun.lock"), "");
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "example-project",
      }),
    );

    const context = detectInitProjectContext(dir, "claude");

    expect(context.projectName).toBe("example-project");
    expect(context.packageManager).toBe("bun");
    expect(context.mainBranch).toBe("main");
    expect(context.defaultAgent).toBe("claude");
  });
});

describe("buildInitPromptSpec", () => {
  it("keeps the user prompt minimal and moves all guidance into the system prompt", () => {
    const prompt = buildInitPromptSpec({
      gitRoot: "/repo",
      projectName: "example",
      mainBranch: "main",
      defaultAgent: "codex",
      packageManager: "bun",
    });

    expect(prompt.systemPrompt).toContain("Set workspace.defaultAgent to codex");
    expect(prompt.systemPrompt).toContain("Infer the config from the repository contents.");
    expect(prompt.userPrompt).toBe("Adapt the existing starter `.webmux.yaml` for this repository.");
    expect(prompt.userPrompt).not.toContain("Project name:");
    expect(prompt.userPrompt).not.toContain("Main branch:");
    expect(prompt.userPrompt).not.toContain("Package manager:");
  });
});

describe("buildStarterTemplate", () => {
  it("uses the detected package manager in the starter command", () => {
    const template = buildStarterTemplate({
      projectName: "example",
      mainBranch: "main",
      defaultAgent: "codex",
      packageManager: "bun",
    });

    expect(template).toContain("defaultAgent: codex");
    expect(template).toContain("mainBranch: main");
    expect(template).toContain("command: PORT=$PORT bun run dev");
  });
});
