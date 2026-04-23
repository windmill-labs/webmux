import { describe, expect, it } from "bun:test";
import { validateCustomAgentInput } from "../services/agent-validation-service";

describe("validateCustomAgentInput", () => {
  it("returns a normalized id and warns when prompt or resume support is missing", () => {
    expect(validateCustomAgentInput({
      label: "Gemini CLI",
      startCommand: "gemini",
    })).toEqual({
      normalizedId: "gemini-cli",
      warnings: [
        "Start command does not reference ${PROMPT} or ${SYSTEM_PROMPT}; initial prompts will not be passed automatically",
        "Resume command is not configured; reopening the worktree will restart the agent",
      ],
    });
  });

  it("returns no warnings for prompt-aware commands with resume support", () => {
    expect(validateCustomAgentInput({
      label: "Gemini CLI",
      startCommand: 'gemini --prompt "${PROMPT}"',
      resumeCommand: 'gemini resume --branch "${BRANCH}"',
    })).toEqual({
      normalizedId: "gemini-cli",
      warnings: [],
    });
  });
});
