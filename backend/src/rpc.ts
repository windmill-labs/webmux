import { listWorktrees, getStatus, mergeWorktree, removeWorktree } from "./workmux";
import { loadRpcSecret } from "./rpc-secret";
import { jsonResponse } from "./http";

type RpcRequest =
  | { command: "list" }
  | { command: "status" }
  | { command: "merge"; name: string }
  | { command: "rm"; name: string }

type RpcResponse = { ok: true; output: string } | { ok: false; error: string }

const VALID_NAME_RE = /^[a-zA-Z0-9._\/-]+$/;

export async function handleWorkmuxRpc(req: Request): Promise<Response> {
  const secret = await loadRpcSecret();
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (token !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let raw: { command?: string; name?: string };
  try {
    raw = await req.json() as { command?: string; name?: string };
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" } satisfies RpcResponse, 400);
  }

  const { command, name } = raw;

  if (name && !VALID_NAME_RE.test(name)) {
    return jsonResponse({ ok: false, error: "Invalid name" } satisfies RpcResponse, 400);
  }

  try {
    switch (command) {
      case "list": {
        const result = await listWorktrees();
        return jsonResponse({ ok: true, output: JSON.stringify(result) } satisfies RpcResponse);
      }
      case "status": {
        const result = await getStatus();
        return jsonResponse({ ok: true, output: JSON.stringify(result) } satisfies RpcResponse);
      }
      case "merge": {
        if (!name) return jsonResponse({ ok: false, error: "Missing name" } satisfies RpcResponse, 400);
        const result = await mergeWorktree(name);
        if (!result.ok) return jsonResponse({ ok: false, error: result.error } satisfies RpcResponse, 422);
        return jsonResponse({ ok: true, output: result.output } satisfies RpcResponse);
      }
      case "rm": {
        if (!name) return jsonResponse({ ok: false, error: "Missing name" } satisfies RpcResponse, 400);
        const result = await removeWorktree(name);
        if (!result.ok) return jsonResponse({ ok: false, error: result.error } satisfies RpcResponse, 422);
        return jsonResponse({ ok: true, output: result.output } satisfies RpcResponse);
      }
      default:
        return jsonResponse({ ok: false, error: `Unknown command: ${command ?? ""}` } satisfies RpcResponse, 400);
    }
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return jsonResponse({ ok: false, error } satisfies RpcResponse, 500);
  }
}

export type { RpcRequest, RpcResponse };
