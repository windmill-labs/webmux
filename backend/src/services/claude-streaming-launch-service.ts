import { buildRuntimeEnvMap, loadDotenvLocal } from "../adapters/fs";
import type { ProfileConfig } from "../domain/config";
import type { WorktreeMeta } from "../domain/model";

export interface ClaudeStreamingLaunchContext {
  env: Record<string, string>;
  permissionMode: "bypassPermissions" | null;
  systemPrompt: string | null;
}

export async function buildClaudeStreamingLaunchContext(input: {
  meta: WorktreeMeta;
  profile: ProfileConfig;
  worktreePath: string;
}): Promise<ClaudeStreamingLaunchContext | null> {
  if (input.meta.runtime !== "host" || input.profile.runtime !== "host") {
    return null;
  }

  const dotenvValues = await loadDotenvLocal(input.worktreePath);
  return {
    env: buildRuntimeEnvMap(input.meta, {
      WEBMUX_WORKTREE_PATH: input.worktreePath,
    }, dotenvValues),
    permissionMode: input.profile.yolo === true ? "bypassPermissions" : null,
    systemPrompt: input.profile.systemPrompt ?? null,
  };
}
