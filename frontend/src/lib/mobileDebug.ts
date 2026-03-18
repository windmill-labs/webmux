import type { MobileDebugEntry, MobileDebugState, MobileDebugValue } from "./types";

const STORAGE_KEY = "wm-mobile-debug";
const MAX_EVENTS = 24;
const listeners = new Set<() => void>();

const state: MobileDebugState = {
  enabled: false,
  latest: {},
  events: [],
};

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function detectEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("mobileDebug") === "1" || window.localStorage.getItem(STORAGE_KEY) === "1";
}

function updateUrlDebugFlag(enabled: boolean): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (enabled) {
    url.searchParams.set("mobileDebug", "1");
  } else {
    url.searchParams.delete("mobileDebug");
  }
  window.history.replaceState({}, "", url);
}

function syncEnabled(): void {
  const nextEnabled = detectEnabled();
  if (state.enabled === nextEnabled) return;
  state.enabled = nextEnabled;
  notify();
}

function buildEntry(
  scope: string,
  fields: Record<string, MobileDebugValue>,
): MobileDebugEntry {
  return {
    timestamp: new Date().toISOString().slice(11, 19),
    scope,
    fields,
  };
}

export function isMobileDebugEnabled(): boolean {
  syncEnabled();
  return state.enabled;
}

export function setMobileDebugEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  if (enabled) {
    window.localStorage.setItem(STORAGE_KEY, "1");
    updateUrlDebugFlag(true);
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
    updateUrlDebugFlag(false);
  }
  syncEnabled();
}

export function recordMobileDebug(
  scope: string,
  fields: Record<string, MobileDebugValue>,
): void {
  if (!isMobileDebugEnabled()) return;
  const entry = buildEntry(scope, fields);
  state.latest = { ...state.latest, [scope]: entry };
  state.events = [entry, ...state.events].slice(0, MAX_EVENTS);
  console.debug(`[mobile-debug:${scope}]`, fields);
  notify();
}

export function getMobileDebugState(): MobileDebugState {
  syncEnabled();
  return {
    enabled: state.enabled,
    latest: { ...state.latest },
    events: [...state.events],
  };
}

export function subscribeMobileDebug(listener: () => void): () => void {
  listeners.add(listener);
  syncEnabled();
  listener();

  if (typeof window !== "undefined") {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === STORAGE_KEY) {
        syncEnabled();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  return () => {
    listeners.delete(listener);
  };
}
