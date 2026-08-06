import { log } from "../lib/log";
import type { PaneSplit } from "../domain/config";
import { stripProjectEnv } from "./project-env";
import {
  parsePaneTarget,
  type SessionGateway,
  type SessionWindowSummary,
} from "./session-gateway";

/** Protocol version this adapter was written against (`ping` reports it). herdr
 *  is pre-1.0, so a mismatch is worth surfacing loudly rather than failing on a
 *  renamed field ten calls later. */
export const EXPECTED_PROTOCOL = 19;

const REQUEST_TIMEOUT_MS = 10_000;
const SERVER_START_TIMEOUT_MS = 10_000;

interface HerdrError {
  code: string;
  message: string;
}

interface HerdrResponse {
  id?: string;
  result?: Record<string, unknown>;
  error?: HerdrError;
}

export class HerdrRequestError extends Error {
  constructor(readonly method: string, readonly code: string, message: string) {
    super(`herdr ${method} failed: ${code}: ${message}`);
    this.name = "HerdrRequestError";
  }
}

/** herdr addresses panes as `w<N>:p<M>` and tabs as `w<N>:t<M>`. webmux pane
 *  handles are opaque, so these are what {@link HerdrGateway.getPaneId} hands
 *  back — and what must be distinguished from a `session:window.index` target. */
const HERDR_PANE_ID = /^w\d+:p\d+$/;

export function isHerdrPaneId(value: string): boolean {
  return HERDR_PANE_ID.test(value);
}

export function resolveSocketPath(env: Record<string, string | undefined>): string {
  const explicit = env.HERDR_SOCKET_PATH;
  if (explicit) return explicit;

  const home = env.HOME ?? "";
  const session = env.HERDR_SESSION;
  return session
    ? `${home}/.config/herdr/sessions/${session}/herdr.sock`
    : `${home}/.config/herdr/herdr.sock`;
}

/** One request, one connection. herdr answers a single request per connection
 *  and then stops reading — reusing a socket silently hangs every call after the
 *  first (only `events.subscribe` is long-lived, which webmux does not use here). */
async function request(
  socketPath: string,
  method: string,
  params: Record<string, unknown>,
): Promise<HerdrResponse> {
  return await new Promise<HerdrResponse>((resolve, reject) => {
    let buffer = "";
    let settled = false;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    const timer = setTimeout(() => {
      settle(() => reject(new HerdrRequestError(method, "timeout", `no response in ${REQUEST_TIMEOUT_MS}ms`)));
    }, REQUEST_TIMEOUT_MS);

    Bun.connect({
      unix: socketPath,
      socket: {
        data(socket, chunk) {
          buffer += new TextDecoder().decode(chunk);
          const newline = buffer.indexOf("\n");
          if (newline < 0) return;
          const line = buffer.slice(0, newline);
          socket.end();
          clearTimeout(timer);
          try {
            settle(() => resolve(JSON.parse(line) as HerdrResponse));
          } catch {
            settle(() => reject(new HerdrRequestError(method, "invalid_response", line.slice(0, 200))));
          }
        },
        close() {
          clearTimeout(timer);
          settle(() => reject(new HerdrRequestError(method, "closed", "connection closed before a response")));
        },
        error(_socket, error) {
          clearTimeout(timer);
          settle(() => reject(new HerdrRequestError(method, "socket_error", String(error))));
        },
      },
    }).then(
      (socket) => {
        socket.write(`${JSON.stringify({ id: `wm_${method}`, method, params })}\n`);
        socket.flush();
      },
      (error: unknown) => {
        clearTimeout(timer);
        settle(() => reject(new HerdrRequestError(method, "connect_failed", String(error))));
      },
    );
  });
}

interface WorkspaceSummary {
  workspace_id: string;
  label?: string | null;
}

interface TabSummary {
  tab_id: string;
  workspace_id: string;
  label?: string | null;
  pane_count?: number;
}

interface PaneSummary {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key];
  return typeof value === "string" ? value : null;
}

function parseWorkspaces(result: Record<string, unknown> | undefined): WorkspaceSummary[] {
  return asArray(result?.workspaces).flatMap((entry) => {
    const record = asRecord(entry);
    const id = readString(record, "workspace_id");
    return id ? [{ workspace_id: id, label: readString(record, "label") }] : [];
  });
}

function parseTabs(result: Record<string, unknown> | undefined): TabSummary[] {
  return asArray(result?.tabs).flatMap((entry) => {
    const record = asRecord(entry);
    const id = readString(record, "tab_id");
    const workspaceId = readString(record, "workspace_id");
    if (!id || !workspaceId) return [];
    const paneCount = record?.pane_count;
    return [{
      tab_id: id,
      workspace_id: workspaceId,
      label: readString(record, "label"),
      pane_count: typeof paneCount === "number" ? paneCount : 0,
    }];
  });
}

function parsePanes(result: Record<string, unknown> | undefined): PaneSummary[] {
  return asArray(result?.panes).flatMap((entry) => {
    const record = asRecord(entry);
    const id = readString(record, "pane_id");
    const tabId = readString(record, "tab_id");
    const workspaceId = readString(record, "workspace_id");
    return id && tabId && workspaceId
      ? [{ pane_id: id, tab_id: tabId, workspace_id: workspaceId }]
      : [];
  });
}

/** Pull a pane id out of the several shapes herdr returns it in: `pane.split`
 *  answers `{pane}`, `tab.create` and `workspace.create` answer `{root_pane}`. */
function readPaneId(result: Record<string, unknown> | undefined): string | null {
  for (const key of ["pane", "root_pane"]) {
    const id = readString(asRecord(result?.[key]), "pane_id");
    if (id) return id;
  }
  return null;
}

/** Drives herdr's local socket API.
 *
 *  webmux's session/window/pane vocabulary maps onto herdr as
 *  session→workspace (matched by label), window→tab (matched by label),
 *  pane→pane. Labels are the join key because webmux persists names, not ids,
 *  and ids do not survive a herdr restart. */
export class HerdrGateway implements SessionGateway {
  private readonly socketPath: string;
  private protocolChecked = false;

  constructor(private readonly env: Record<string, string | undefined> = Bun.env) {
    this.socketPath = resolveSocketPath(env);
  }

  private async call(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const response = await request(this.socketPath, method, params);
    if (response.error) {
      throw new HerdrRequestError(method, response.error.code, response.error.message);
    }
    return response.result ?? {};
  }

  /** Like {@link call} but treats "the thing is already gone" as success, so
   *  teardown is idempotent the way tmux's kill-window is. */
  private async callTolerant(method: string, params: Record<string, unknown>): Promise<void> {
    try {
      await this.call(method, params);
    } catch (error) {
      if (error instanceof HerdrRequestError && error.code === "not_found") return;
      throw error;
    }
  }

  async ensureServer(): Promise<void> {
    if (await this.pingOk()) return;

    // Unlike tmux, herdr never self-daemonizes on first use: `ping` reports
    // `detached_server_daemon: false` and every other method answers
    // `server_not_running`. webmux has to start and detach the server itself.
    log.info(`[herdr] no server at ${this.socketPath}; starting one`);
    Bun.spawn(["herdr", "server"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      env: stripProjectEnv(this.env),
    }).unref();

    const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await Bun.sleep(100);
      if (await this.pingOk()) return;
    }
    throw new Error(
      `herdr server did not come up at ${this.socketPath} within ${SERVER_START_TIMEOUT_MS}ms`,
    );
  }

  private async pingOk(): Promise<boolean> {
    try {
      const result = await this.call("ping");
      this.warnOnProtocolMismatch(result);
      return true;
    } catch {
      return false;
    }
  }

  private warnOnProtocolMismatch(result: Record<string, unknown>): void {
    if (this.protocolChecked) return;
    this.protocolChecked = true;
    const protocol = result.protocol;
    if (typeof protocol === "number" && protocol !== EXPECTED_PROTOCOL) {
      log.warn(
        `[herdr] protocol ${protocol} differs from the expected ${EXPECTED_PROTOCOL}; `
        + "pane orchestration may misbehave — upgrade webmux or pin herdr",
      );
    }
  }

  private async findWorkspace(sessionName: string): Promise<WorkspaceSummary | null> {
    const workspaces = parseWorkspaces(await this.call("workspace.list"));
    return workspaces.find((workspace) => workspace.label === sessionName) ?? null;
  }

  private async findTab(sessionName: string, windowName: string): Promise<TabSummary | null> {
    const workspace = await this.findWorkspace(sessionName);
    if (!workspace) return null;
    const tabs = parseTabs(await this.call("tab.list", { workspace_id: workspace.workspace_id }));
    return tabs.find((tab) => tab.label === windowName) ?? null;
  }

  private async listPanes(tabId: string): Promise<PaneSummary[]> {
    return parsePanes(await this.call("pane.list", { tab_id: tabId }));
  }

  /** Resolve any target webmux hands the gateway to a concrete herdr pane id:
   *  either an opaque handle this gateway already minted, or a
   *  `session:window.index` target that has to be looked up by label. */
  private async resolvePaneId(target: string): Promise<string | null> {
    if (isHerdrPaneId(target)) return target;

    const parsed = parsePaneTarget(target);
    if (!parsed) return null;

    const tab = await this.findTab(parsed.sessionName, parsed.windowName);
    if (!tab) return null;

    const panes = await this.listPanes(tab.tab_id);
    return panes[parsed.paneIndex ?? 0]?.pane_id ?? null;
  }

  private async requirePaneId(target: string, action: string): Promise<string> {
    const paneId = await this.resolvePaneId(target);
    if (!paneId) throw new Error(`${action}: no herdr pane matches target ${target}`);
    return paneId;
  }

  async ensureSession(sessionName: string, cwd: string): Promise<void> {
    if (await this.findWorkspace(sessionName)) return;
    await this.call("workspace.create", { cwd, label: sessionName, focus: false });
  }

  async hasWindow(sessionName: string, windowName: string): Promise<boolean> {
    return await this.findTab(sessionName, windowName) !== null;
  }

  async killWindow(sessionName: string, windowName: string): Promise<void> {
    const tab = await this.findTab(sessionName, windowName);
    if (!tab) return;
    await this.callTolerant("tab.close", { tab_id: tab.tab_id });
  }

  async createWindow(opts: {
    sessionName: string;
    windowName: string;
    cwd: string;
    command?: string;
  }): Promise<void> {
    const workspace = await this.findWorkspace(opts.sessionName);
    if (!workspace) throw new Error(`createWindow: no herdr workspace labelled ${opts.sessionName}`);

    const result = await this.call("tab.create", {
      workspace_id: workspace.workspace_id,
      label: opts.windowName,
      cwd: opts.cwd,
      focus: false,
    });

    if (opts.command) {
      const paneId = readPaneId(result);
      if (paneId) await this.sendCommand(paneId, opts.command);
    }
  }

  async splitWindow(opts: {
    target: string;
    split: PaneSplit;
    sizePct?: number;
    cwd: string;
    command?: string;
  }): Promise<void> {
    const paneId = await this.requirePaneId(opts.target, "splitWindow");
    const result = await this.call("pane.split", {
      pane_id: paneId,
      direction: opts.split === "right" ? "right" : "down",
      cwd: opts.cwd,
      ...(opts.sizePct !== undefined ? { ratio: opts.sizePct / 100 } : {}),
    });

    if (opts.command) {
      const created = readPaneId(result);
      if (created) await this.sendCommand(created, opts.command);
    }
  }

  /** herdr's send_text is literal — a trailing newline is what submits it. */
  private async sendCommand(paneId: string, command: string): Promise<void> {
    await this.call("pane.send_text", { pane_id: paneId, text: `${command}\n` });
  }

  async runCommand(target: string, command: string): Promise<void> {
    await this.sendCommand(await this.requirePaneId(target, "runCommand"), command);
  }

  async selectPane(target: string): Promise<void> {
    await this.call("pane.focus", { pane_id: await this.requirePaneId(target, "selectPane") });
  }

  async listWindows(): Promise<SessionWindowSummary[]> {
    const workspaces = parseWorkspaces(await this.call("workspace.list"));
    const summaries = await Promise.all(workspaces.map(async (workspace) => {
      if (!workspace.label) return [];
      const tabs = parseTabs(await this.call("tab.list", { workspace_id: workspace.workspace_id }));
      return tabs.flatMap((tab) => tab.label
        ? [{ sessionName: workspace.label!, windowName: tab.label, paneCount: tab.pane_count ?? 0 }]
        : []);
    }));
    return summaries.flat();
  }

  async getPaneId(target: string): Promise<string> {
    return await this.requirePaneId(target, "getPaneId");
  }

  async createParkedPane(opts: {
    sessionName: string;
    parkingWindow: string;
    cwd: string;
    command: string;
  }): Promise<string> {
    const existing = await this.findTab(opts.sessionName, opts.parkingWindow);
    if (!existing) {
      await this.createWindow({
        sessionName: opts.sessionName,
        windowName: opts.parkingWindow,
        cwd: opts.cwd,
        command: opts.command,
      });
      const created = await this.findTab(opts.sessionName, opts.parkingWindow);
      if (!created) throw new Error(`createParkedPane: parking tab ${opts.parkingWindow} vanished after creation`);
      const panes = await this.listPanes(created.tab_id);
      const paneId = panes[0]?.pane_id;
      if (!paneId) throw new Error(`createParkedPane: parking tab ${opts.parkingWindow} has no pane`);
      return paneId;
    }

    const panes = await this.listPanes(existing.tab_id);
    const anchor = panes[panes.length - 1]?.pane_id;
    if (!anchor) throw new Error(`createParkedPane: parking tab ${opts.parkingWindow} has no pane to split`);

    const result = await this.call("pane.split", { pane_id: anchor, direction: "right", cwd: opts.cwd });
    const created = readPaneId(result);
    if (!created) throw new Error(`createParkedPane: herdr returned no pane id for ${opts.parkingWindow}`);
    await this.sendCommand(created, opts.command);
    return created;
  }

  async swapPanes(source: string, destination: string): Promise<void> {
    await this.call("pane.swap", {
      source_pane_id: await this.requirePaneId(source, "swapPanes"),
      target_pane_id: await this.requirePaneId(destination, "swapPanes"),
    });
  }

  async killPane(target: string): Promise<void> {
    const paneId = await this.resolvePaneId(target);
    if (!paneId) return;
    await this.callTolerant("pane.close", { pane_id: paneId });
  }
}
