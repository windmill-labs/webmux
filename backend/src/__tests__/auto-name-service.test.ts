import { describe, expect, it } from "bun:test";
import { AutoNameService } from "../services/auto-name-service";

describe("AutoNameService", () => {
  it("calls Anthropic's messages API for claude models", async () => {
    let calledUrl = "";
    let calledInit: RequestInit | undefined;
    const service = new AutoNameService({
      anthropicApiKey: "anthropic-key",
      fetchImpl: async (url, init) => {
        calledUrl = String(url);
        calledInit = init;
        return new Response(JSON.stringify({
          content: [{ type: "text", text: "{\"branch_name\":\"fix-login-flow\"}" }],
        }));
      },
    });

    const branch = await service.generateBranchName(
      {
        model: "claude-3-5-haiku-latest",
        systemPrompt: "Generate a branch name",
      },
      "Fix the login flow",
    );

    expect(branch).toBe("fix-login-flow");
    expect(calledUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(calledInit?.headers).toEqual({
      "content-type": "application/json",
      "x-api-key": "anthropic-key",
      "anthropic-version": "2023-06-01",
    });
    expect(JSON.parse(String(calledInit?.body))).toEqual({
      model: "claude-3-5-haiku-latest",
      system: "Generate a branch name",
      max_tokens: 64,
      messages: [{ role: "user", content: "Task description:\nFix the login flow" }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              branch_name: {
                type: "string",
                description: "A lowercase kebab-case git branch name with no prefix",
              },
            },
            required: ["branch_name"],
            additionalProperties: false,
          },
        },
      },
    });
  });

  it("calls Google's generateContent API for gemini models", async () => {
    let calledUrl = "";
    let calledInit: RequestInit | undefined;
    const service = new AutoNameService({
      geminiApiKey: "gemini-key",
      fetchImpl: async (url, init) => {
        calledUrl = String(url);
        calledInit = init;
        return new Response(JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "{\"branch_name\":\"improve-search-ranking\"}" }],
              },
            },
          ],
        }));
      },
    });

    const branch = await service.generateBranchName(
      {
        model: "gemini-2.5-flash",
        systemPrompt: "Generate a branch name",
      },
      "Improve search ranking",
    );

    expect(branch).toBe("improve-search-ranking");
    expect(calledUrl).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect(calledInit?.headers).toEqual({
      "content-type": "application/json",
      "x-goog-api-key": "gemini-key",
    });
    expect(JSON.parse(String(calledInit?.body))).toEqual({
      systemInstruction: {
        parts: [{ text: "Generate a branch name" }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: "Task description:\nImprove search ranking" }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            branch_name: {
              type: "string",
              description: "A lowercase kebab-case git branch name with no prefix",
            },
          },
          required: ["branch_name"],
          additionalProperties: false,
          propertyOrdering: ["branch_name"],
        },
      },
    });
  });

  it("calls OpenAI's responses API for OpenAI models", async () => {
    let calledUrl = "";
    let calledInit: RequestInit | undefined;
    const service = new AutoNameService({
      openaiApiKey: "openai-key",
      fetchImpl: async (url, init) => {
        calledUrl = String(url);
        calledInit = init;
        return new Response(JSON.stringify({
          output: [
            {
              content: [{ type: "output_text", text: "{\"branch_name\":\"add-bulk-actions\"}" }],
            },
          ],
        }));
      },
    });

    const branch = await service.generateBranchName(
      {
        model: "openai/gpt-5-mini",
        systemPrompt: "Generate a branch name",
      },
      "Add bulk actions to the list view",
    );

    expect(branch).toBe("add-bulk-actions");
    expect(calledUrl).toBe("https://api.openai.com/v1/responses");
    expect(calledInit?.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer openai-key",
    });
    expect(JSON.parse(String(calledInit?.body))).toEqual({
      model: "gpt-5-mini",
      input: [
        { role: "system", content: "Generate a branch name" },
        { role: "user", content: "Task description:\nAdd bulk actions to the list view" },
      ],
      max_output_tokens: 64,
      text: {
        format: {
          type: "json_schema",
          name: "branch_name_response",
          strict: true,
          schema: {
            type: "object",
            properties: {
              branch_name: {
                type: "string",
                description: "A lowercase kebab-case git branch name with no prefix",
              },
            },
            required: ["branch_name"],
            additionalProperties: false,
          },
        },
      },
    });
  });

  it("fails clearly when the matching provider key is missing", async () => {
    const service = new AutoNameService({
      fetchImpl: async () => new Response("{}"),
    });

    await expect(service.generateBranchName(
      { model: "gemini-2.5-flash" },
      "Improve search ranking",
    )).rejects.toThrow("GEMINI_API_KEY is required");
  });
});
