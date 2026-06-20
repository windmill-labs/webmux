import type { AskUserQuestionInput, AskUserQuestionItem, AskUserQuestionOption } from "./types";

export const ASK_USER_QUESTION_TOOL_NAME = "AskUserQuestion";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOption(value: unknown): AskUserQuestionOption | null {
  if (!isRecord(value) || typeof value.label !== "string" || value.label.length === 0) {
    return null;
  }
  return {
    label: value.label,
    ...(typeof value.description === "string" ? { description: value.description } : {}),
  };
}

function parseQuestion(value: unknown): AskUserQuestionItem | null {
  if (!isRecord(value)) return null;
  if (typeof value.question !== "string" || typeof value.header !== "string") return null;
  if (!Array.isArray(value.options)) return null;

  const options: AskUserQuestionOption[] = [];
  for (const rawOption of value.options) {
    const option = parseOption(rawOption);
    if (!option) return null;
    options.push(option);
  }
  if (options.length === 0) return null;

  return {
    question: value.question,
    header: value.header,
    ...(typeof value.multiSelect === "boolean" ? { multiSelect: value.multiSelect } : {}),
    options,
  };
}

// Parses the `toolUse.text` payload of an AskUserQuestion call (the compact JSON
// the backend forwards verbatim) into a validated structure. Returns null on any
// shape mismatch so callers can fall back to the generic tool rendering.
export function parseAskUserQuestion(text: string): AskUserQuestionInput | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.questions)) return null;

  const questions: AskUserQuestionItem[] = [];
  for (const rawQuestion of parsed.questions) {
    const question = parseQuestion(rawQuestion);
    if (!question) return null;
    questions.push(question);
  }
  if (questions.length === 0) return null;

  return { questions };
}

// Builds the follow-up message text sent back to Claude when the user answers.
// Each answered question becomes a `${header}: ${values}` line; empty questions
// are dropped.
export function formatAskUserQuestionAnswer(
  answers: Array<{ header: string; values: string[] }>,
): string {
  return answers
    .filter((answer) => answer.values.length > 0)
    .map((answer) => `${answer.header}: ${answer.values.join(", ")}`)
    .join("\n");
}
