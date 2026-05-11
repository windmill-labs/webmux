import type { AgentsUiConversationMessage, AgentsUiConversationState } from "@webmux/api-contract";
import { log } from "../lib/log";
import {
  attachToIssue,
  buildLinearSummaryMarkdown,
  buildWebmuxAttachmentTitle,
  createIssueComment,
  createLinearIssue,
  fetchIssueWithAttachments,
  fetchTeamByKey,
  findLinkedGitHubPr,
  findWebmuxAttachment,
  type LinearAttachment,
  type LinearIssueWithAttachments,
  uploadAttachmentFile,
} from "./linear-service";

// ── Types ──────────────────────────────────────────────────────────────────

export interface WebmuxConversationAttachmentPayload {
  webmux: 1;
  branch: string;
  baseBranch: string | null;
  lastSha: string | null;
  agent: string | null;
  createdAt: string;
  conversation: AgentsUiConversationMessage[];
}

export interface ExportTargetIssue {
  kind: "issue";
  issueId: string;
}

export interface ExportTargetTeam {
  kind: "team";
  teamKey: string;
  title?: string;
}

export type ExportTarget = ExportTargetIssue | ExportTargetTeam;

export interface ExportConversationInput {
  target: ExportTarget;
  branch: string;
  baseBranch: string | null;
  lastSha: string | null;
  agent: string | null;
  prUrl: string | null;
  conversation: AgentsUiConversationState;
  webmuxVersion?: string;
  now?: () => Date;
}

export interface ExportConversationDependencies {
  fetchIssueWithAttachments: typeof fetchIssueWithAttachments;
  fetchTeamByKey: typeof fetchTeamByKey;
  createLinearIssue: typeof createLinearIssue;
  uploadAttachmentFile: typeof uploadAttachmentFile;
  attachToIssue: typeof attachToIssue;
  createIssueComment: typeof createIssueComment;
}

export interface ExportedConversation {
  issueId: string;
  issueUrl: string;
  commentUrl: string | null;
  attachmentUrl: string;
}

export type ExportConversationResult =
  | { ok: true; data: ExportedConversation }
  | { ok: false; error: string; status: number };

export interface SeedFromLinearInput {
  issueId: string;
  preferBranch?: string;
}

export interface SeedFromLinearDependencies {
  fetchIssueWithAttachments: typeof fetchIssueWithAttachments;
  downloadWebmuxAttachment: (url: string) => Promise<{ ok: true; data: WebmuxConversationAttachmentPayload } | { ok: false; error: string }>;
}

export interface LinearSeedResult {
  source: "webmux-attachment" | "github-integration" | "none";
  branch: string | null;
  baseBranch: string | null;
  prUrl: string | null;
  conversationMarkdown: string | null;
}

export type BuildSeedResult =
  | { ok: true; data: LinearSeedResult }
  | { ok: false; error: string; status: number };

// ── Pure helpers ───────────────────────────────────────────────────────────

export function countConversationTurns(conversation: AgentsUiConversationState): number {
  return new Set(conversation.messages.map((m) => m.turnId)).size;
}

export function deriveIssueTitleFromPrompt(prompt: string | undefined, fallbackBranch: string): string {
  const firstLine = prompt
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine) {
    return firstLine.length > 100 ? `${firstLine.slice(0, 97)}...` : firstLine;
  }
  return `Webmux session: ${fallbackBranch}`;
}

function escapeFence(text: string): string {
  // Defensive: an assistant message could theoretically contain ``` which would
  // close our fenced block. Replace inner triple-backticks with a zero-width
  // separator so the rendered markdown stays a single block.
  return text.replace(/```/g, "``​`");
}

export function renderConversationAsMarkdown(conversation: AgentsUiConversationState): string {
  const lines: string[] = [];
  for (const message of conversation.messages) {
    const ts = message.createdAt ? ` (${message.createdAt})` : "";
    lines.push(`### ${message.role}${ts}`);
    lines.push("");
    lines.push(escapeFence(message.text));
    lines.push("");
  }
  return lines.join("\n");
}

export function buildConversationAttachmentPayload(input: ExportConversationInput): WebmuxConversationAttachmentPayload {
  const now = input.now ?? (() => new Date());
  return {
    webmux: 1,
    branch: input.branch,
    baseBranch: input.baseBranch,
    lastSha: input.lastSha,
    agent: input.agent,
    createdAt: now().toISOString(),
    conversation: input.conversation.messages,
  };
}

// ── Orchestrators ──────────────────────────────────────────────────────────

async function resolveIssue(
  input: ExportConversationInput,
  deps: ExportConversationDependencies,
): Promise<
  | { ok: true; issueId: string; issueUrl: string }
  | { ok: false; error: string; status: number }
> {
  if (input.target.kind === "issue") {
    const issue = await deps.fetchIssueWithAttachments(input.target.issueId);
    if (!issue.ok) return issue;
    return { ok: true, issueId: issue.data.id, issueUrl: issue.data.url };
  }

  const team = await deps.fetchTeamByKey(input.target.teamKey);
  if (!team.ok) return team;

  const titleFromPrompt = input.target.title?.trim();
  const title = titleFromPrompt && titleFromPrompt.length > 0
    ? titleFromPrompt
    : `Webmux session: ${input.branch}`;
  const description = [
    `Created from a webmux session on branch \`${input.branch}\`.`,
    input.prUrl ? `\nPR: ${input.prUrl}` : "",
  ].filter(Boolean).join("\n");

  const created = await deps.createLinearIssue({
    teamId: team.data.id,
    title,
    description,
  });
  if (!created.ok) return { ok: false, error: created.error, status: 502 };
  return { ok: true, issueId: created.data.id, issueUrl: created.data.url };
}

export async function exportConversationToLinear(
  input: ExportConversationInput,
  deps: ExportConversationDependencies,
): Promise<ExportConversationResult> {
  const issue = await resolveIssue(input, deps);
  if (!issue.ok) return issue;

  const payload = buildConversationAttachmentPayload(input);
  const attachmentTitle = buildWebmuxAttachmentTitle(input.branch);
  const bodyBytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
  const filename = `${attachmentTitle}.json`;

  const upload = await deps.uploadAttachmentFile({
    filename,
    contentType: "application/json",
    body: bodyBytes.buffer as ArrayBuffer,
  });
  if (!upload.ok) {
    return { ok: false, error: `Linear file upload failed: ${upload.error}`, status: 502 };
  }

  const attached = await deps.attachToIssue({
    issueId: issue.issueId,
    title: attachmentTitle,
    url: upload.data.assetUrl,
    subtitle: input.prUrl ?? undefined,
  });
  if (!attached.ok) {
    return { ok: false, error: `Linear attachmentCreate failed: ${attached.error}`, status: 502 };
  }

  const summary = buildLinearSummaryMarkdown({
    branch: input.branch,
    baseBranch: input.baseBranch ?? undefined,
    turns: countConversationTurns(input.conversation),
    prUrl: input.prUrl ?? undefined,
    attachmentTitle,
    webmuxVersion: input.webmuxVersion,
  });

  const comment = await deps.createIssueComment({
    issueId: issue.issueId,
    body: summary,
  });
  // Comment failure is non-fatal: the attachment is already saved.
  let commentUrl: string | null = null;
  if (comment.ok) {
    commentUrl = comment.data.url;
  } else {
    log.error(`[linear] comment creation failed (attachment still saved): ${comment.error}`);
  }

  return {
    ok: true,
    data: {
      issueId: issue.issueId,
      issueUrl: issue.issueUrl,
      attachmentUrl: upload.data.assetUrl,
      commentUrl,
    },
  };
}

// ── Seed resolution (resume-from-linear) ───────────────────────────────────

interface ResolvedSeedFromAttachment {
  branch: string | null;
  baseBranch: string | null;
  conversationMarkdown: string;
}

function buildSeedConversationMarkdown(payload: WebmuxConversationAttachmentPayload): string {
  const lines: string[] = [];
  lines.push(`The following conversation was previously run on branch \`${payload.branch}\` and saved to this Linear issue.`);
  if (payload.baseBranch) lines.push(`Base: \`${payload.baseBranch}\`.`);
  if (payload.lastSha) lines.push(`Last commit sha: \`${payload.lastSha}\`.`);
  lines.push("");
  lines.push("Previous conversation (chronological):");
  lines.push("");
  for (const message of payload.conversation) {
    lines.push(`### ${message.role}`);
    lines.push("");
    lines.push(escapeFence(message.text));
    lines.push("");
  }
  return lines.join("\n");
}

function pickAttachmentSeed(
  issue: LinearIssueWithAttachments,
  payload: WebmuxConversationAttachmentPayload,
): ResolvedSeedFromAttachment {
  void issue;
  return {
    branch: payload.branch,
    baseBranch: payload.baseBranch,
    conversationMarkdown: buildSeedConversationMarkdown(payload),
  };
}

function pickGitHubSeed(issue: LinearIssueWithAttachments): LinearSeedResult | null {
  const pr = findLinkedGitHubPr(issue);
  if (!pr) return null;
  return {
    source: "github-integration",
    branch: pr.branch,
    baseBranch: null,
    prUrl: pr.url,
    conversationMarkdown: null,
  };
}

export async function buildSeedFromLinear(
  input: SeedFromLinearInput,
  deps: SeedFromLinearDependencies,
): Promise<BuildSeedResult> {
  const issue = await deps.fetchIssueWithAttachments(input.issueId);
  if (!issue.ok) return issue;

  const webmuxAttachment = findWebmuxAttachment(issue.data, input.preferBranch);
  const githubSeed = pickGitHubSeed(issue.data);

  if (webmuxAttachment) {
    const payloadResult = await deps.downloadWebmuxAttachment(webmuxAttachment.url);
    if (!payloadResult.ok) {
      // Fall back to GitHub seed if download fails.
      log.error(`[linear] webmux attachment download failed: ${payloadResult.error}`);
      if (githubSeed) return { ok: true, data: githubSeed };
      return { ok: false, error: `webmux attachment found but download failed: ${payloadResult.error}`, status: 502 };
    }
    const seed = pickAttachmentSeed(issue.data, payloadResult.data);
    return {
      ok: true,
      data: {
        source: "webmux-attachment",
        branch: seed.branch,
        baseBranch: seed.baseBranch,
        prUrl: githubSeed?.prUrl ?? null,
        conversationMarkdown: seed.conversationMarkdown,
      },
    };
  }

  if (githubSeed) return { ok: true, data: githubSeed };

  return {
    ok: true,
    data: {
      source: "none",
      branch: issue.data.branchName || null,
      baseBranch: null,
      prUrl: null,
      conversationMarkdown: null,
    },
  };
}

// ── I/O boundary: fetch a webmux attachment body via authenticated GET ─────

export async function downloadWebmuxAttachmentDefault(url: string): Promise<
  { ok: true; data: WebmuxConversationAttachmentPayload } | { ok: false; error: string }
> {
  const apiKey = Bun.env.LINEAR_API_KEY;
  if (!apiKey) return { ok: false, error: "LINEAR_API_KEY not set" };

  try {
    const res = await fetch(url, {
      headers: { Authorization: apiKey },
    });
    if (!res.ok) {
      return { ok: false, error: `Asset download failed ${res.status}` };
    }
    const text = await res.text();
    const parsed = JSON.parse(text) as WebmuxConversationAttachmentPayload;
    if (parsed.webmux !== 1 || !Array.isArray(parsed.conversation)) {
      return { ok: false, error: "Asset is not a webmux conversation payload" };
    }
    return { ok: true, data: parsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

// Silence unused export warnings on the typed alias.
export type _LinearAttachment = LinearAttachment;
