export type WorktreeConversationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number };

export function ok<T>(data: T): WorktreeConversationResult<T> {
  return { ok: true, data };
}

export function err<T>(status: number, error: string): WorktreeConversationResult<T> {
  return { ok: false, status, error };
}
