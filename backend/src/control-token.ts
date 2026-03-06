import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const CONTROL_TOKEN_PATH = `${Bun.env.HOME ?? "/root"}/.config/workmux/rpc-secret`;

let cachedToken: string | null = null;

export async function loadControlToken(): Promise<string> {
  if (cachedToken) return cachedToken;

  const file = Bun.file(CONTROL_TOKEN_PATH);
  if (await file.exists()) {
    cachedToken = (await file.text()).trim();
    return cachedToken;
  }

  const controlToken = crypto.randomUUID();
  await mkdir(dirname(CONTROL_TOKEN_PATH), { recursive: true });
  await Bun.write(CONTROL_TOKEN_PATH, controlToken);
  await chmod(CONTROL_TOKEN_PATH, 0o600);
  cachedToken = controlToken;
  return controlToken;
}
