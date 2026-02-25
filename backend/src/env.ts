/** Read key=value pairs from a worktree's .env.local file. */
export async function readEnvLocal(wtDir: string): Promise<Record<string, string>> {
  try {
    const text = (await Bun.file(`${wtDir}/.env.local`).text()).trim();
    const env: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const match = line.match(/^(\w+)=(.*)$/);
      if (match) env[match[1]] = match[2];
    }
    return env;
  } catch {
    return {};
  }
}

/** Upsert a key=value pair in a worktree's .env.local file. */
export async function upsertEnvLocal(wtDir: string, key: string, value: string): Promise<void> {
  const filePath = `${wtDir}/.env.local`;
  let lines: string[] = [];
  try {
    const content = (await Bun.file(filePath).text()).trim();
    if (content) lines = content.split("\n");
  } catch {
    // File doesn't exist yet, start with empty lines
  }

  const pattern = new RegExp(`^${key}=`);
  const idx = lines.findIndex((l) => pattern.test(l));
  if (idx >= 0) {
    lines[idx] = `${key}=${value}`;
  } else {
    lines.push(`${key}=${value}`);
  }

  await Bun.write(filePath, lines.join("\n") + "\n");
}
