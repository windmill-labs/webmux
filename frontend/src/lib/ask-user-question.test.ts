import { describe, expect, it } from "vitest";
import { formatAskUserQuestionAnswer, parseAskUserQuestion } from "./ask-user-question";

describe("parseAskUserQuestion", () => {
  it("parses a valid single-question payload", () => {
    const text = JSON.stringify({
      questions: [
        {
          question: "Do you prefer cats or dogs?",
          header: "Pet type",
          multiSelect: false,
          options: [
            { label: "Cats", description: "Independent." },
            { label: "Dogs", description: "Loyal." },
          ],
        },
      ],
    });

    const parsed = parseAskUserQuestion(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.questions).toHaveLength(1);
    expect(parsed?.questions[0]?.header).toBe("Pet type");
    expect(parsed?.questions[0]?.multiSelect).toBe(false);
    expect(parsed?.questions[0]?.options.map((option) => option.label)).toEqual(["Cats", "Dogs"]);
  });

  it("returns null for malformed JSON", () => {
    expect(parseAskUserQuestion("{not json")).toBeNull();
  });

  it("returns null when questions is missing", () => {
    expect(parseAskUserQuestion(JSON.stringify({ foo: 1 }))).toBeNull();
  });

  it("returns null when a question has no options", () => {
    const text = JSON.stringify({ questions: [{ question: "q", header: "h", options: [] }] });
    expect(parseAskUserQuestion(text)).toBeNull();
  });

  it("returns null when an option is missing a label", () => {
    const text = JSON.stringify({ questions: [{ question: "q", header: "h", options: [{ description: "x" }] }] });
    expect(parseAskUserQuestion(text)).toBeNull();
  });
});

describe("formatAskUserQuestionAnswer", () => {
  it("formats a single answer as one line", () => {
    expect(formatAskUserQuestionAnswer([{ header: "Pet type", values: ["Cats"] }])).toBe("Pet type: Cats");
  });

  it("joins multiple values and questions", () => {
    expect(
      formatAskUserQuestionAnswer([
        { header: "Pet type", values: ["Cats", "Dogs"] },
        { header: "Size", values: ["Large"] },
      ]),
    ).toBe("Pet type: Cats, Dogs\nSize: Large");
  });

  it("drops questions with no values", () => {
    expect(
      formatAskUserQuestionAnswer([
        { header: "Pet type", values: ["Cats"] },
        { header: "Size", values: [] },
      ]),
    ).toBe("Pet type: Cats");
  });
});
