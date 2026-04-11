import { z } from "zod";
import { errorResponse } from "./lib/http";

type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: Response };

function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  const remainingCount = error.issues.length - 1;
  const remainingSuffix = remainingCount > 0 ? ` (and ${remainingCount} more error${remainingCount === 1 ? "" : "s"})` : "";
  return `${path}${issue.message}${remainingSuffix}`;
}

function readSearchParams(url: URL): Record<string, string | string[]> {
  const data: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    if (values.length === 1) {
      data[key] = values[0] ?? "";
      continue;
    }
    data[key] = values;
  }
  return data;
}

function parseWithSchema<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  label: string,
): ParseResult<z.infer<TSchema>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      response: errorResponse(`${label}: ${formatZodError(parsed.error)}`, 400),
    };
  }
  return {
    ok: true,
    data: parsed.data,
  };
}

function decodeParams(params: Record<string, string>): ParseResult<Record<string, string>> {
  try {
    return {
      ok: true,
      data: Object.fromEntries(
        Object.entries(params).map(([key, value]) => [key, decodeURIComponent(value)]),
      ),
    };
  } catch {
    return {
      ok: false,
      response: errorResponse("Invalid path parameters: malformed encoding", 400),
    };
  }
}

export async function parseJsonBody<TSchema extends z.ZodTypeAny>(
  req: Request,
  schema: TSchema,
): Promise<ParseResult<z.infer<TSchema>>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: errorResponse("Invalid JSON", 400),
    };
  }
  return parseWithSchema(schema, raw, "Invalid request body");
}

export function parseQuery<TSchema extends z.ZodTypeAny>(
  req: Request,
  schema: TSchema,
): ParseResult<z.infer<TSchema>> {
  return parseWithSchema(schema, readSearchParams(new URL(req.url)), "Invalid query");
}

export function parseParams<TSchema extends z.ZodTypeAny>(
  params: Record<string, string>,
  schema: TSchema,
): ParseResult<z.infer<TSchema>> {
  const decoded = decodeParams(params);
  if (!decoded.ok) return decoded;
  return parseWithSchema(schema, decoded.data, "Invalid path parameters");
}
