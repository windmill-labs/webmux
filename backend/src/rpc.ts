import { loadRpcSecret } from "./rpc-secret";
import { jsonResponse } from "./http";

interface RpcRequest {
  command: string;
  args?: string[];
}

type RpcResponse = { ok: true; output: string } | { ok: false; error: string }

export async function handleWorkmuxRpc(req: Request): Promise<Response> {
  const secret = await loadRpcSecret();
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (token !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let raw: RpcRequest;
  try {
    raw = await req.json() as RpcRequest;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" } satisfies RpcResponse, 400);
  }

  const { command, args = [] } = raw;
  if (!command) {
    return jsonResponse({ ok: false, error: "Missing command" } satisfies RpcResponse, 400);
  }

  try {
    const proc = Bun.spawn(["workmux", command, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      return jsonResponse({ ok: false, error: stderr.trim() || `exit code ${exitCode}` } satisfies RpcResponse, 422);
    }
    return jsonResponse({ ok: true, output: stdout.trim() } satisfies RpcResponse);
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return jsonResponse({ ok: false, error } satisfies RpcResponse, 500);
  }
}

export type { RpcRequest, RpcResponse };
