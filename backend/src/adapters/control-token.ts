import { chmod, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { webmuxConfigDir } from "./webmux-paths";

const CONTROL_TOKEN_PATH = join(webmuxConfigDir(), "control-token");

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
