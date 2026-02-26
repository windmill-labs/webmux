import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const SECRET_PATH = `${Bun.env.HOME ?? "/root"}/.config/workmux/rpc-secret`;

let cached: string | null = null;

export async function loadRpcSecret(): Promise<string> {
  if (cached) return cached;
  const file = Bun.file(SECRET_PATH);
  if (await file.exists()) {
    cached = (await file.text()).trim();
    return cached;
  }
  const secret = crypto.randomUUID();
  await mkdir(dirname(SECRET_PATH), { recursive: true });
  await Bun.write(SECRET_PATH, secret);
  await chmod(SECRET_PATH, 0o600);
  cached = secret;
  return secret;
}
