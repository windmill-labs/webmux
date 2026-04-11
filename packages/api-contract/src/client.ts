import { initClient } from "@ts-rest/core";
import { apiContract } from "./contract";

export function createApiClient(baseUrl: string) {
  return initClient(apiContract, {
    baseUrl,
    baseHeaders: {},
  });
}

type SuccessStatus = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226;

type SuccessBody<TResponse> = Extract<TResponse, { status: SuccessStatus }> extends { body: infer TBody }
  ? TBody
  : never;

type UnwrappedClient<TClient> = {
  [K in keyof TClient]: TClient[K] extends (...args: infer TArgs) => Promise<infer TResponse>
    ? (...args: TArgs) => Promise<SuccessBody<TResponse>>
    : TClient[K];
};

function errorMessageFromResponse(body: unknown, status: number): string {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as unknown;
      return errorMessageFromResponse(parsed, status);
    } catch {
      return body.trim() || `HTTP ${status}`;
    }
  }
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return `HTTP ${status}`;
}

function encodeArgs(args: unknown[]): unknown[] {
  const [first, ...rest] = args;
  if (!first || typeof first !== "object" || !("params" in first) || !first.params || typeof first.params !== "object") {
    return args;
  }

  const encodedParams = Object.fromEntries(
    Object.entries(first.params).map(([key, value]) => [key, encodeURIComponent(String(value))]),
  );

  return [
    {
      ...first,
      params: encodedParams,
    },
    ...rest,
  ];
}

export function createApi(baseUrl: string): UnwrappedClient<ReturnType<typeof createApiClient>> {
  const client = createApiClient(baseUrl);

  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }

      return async (...args: unknown[]) => {
        const response = await value(...encodeArgs(args));
        if (!response || typeof response !== "object" || !("status" in response) || !("body" in response)) {
          throw new Error("Malformed API client response");
        }
        if (typeof response.status !== "number" || response.status < 200 || response.status >= 300) {
          throw new Error(errorMessageFromResponse(response.body, response.status));
        }
        return response.body;
      };
    },
  }) as unknown as UnwrappedClient<ReturnType<typeof createApiClient>>;
}

export const api = createApi("");
