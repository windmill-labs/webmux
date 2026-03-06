const ACTIVITY_TIMEOUT_MS = 15_000;

let lastActivityAt = Date.now();

export function touchDashboardActivity(): void {
  lastActivityAt = Date.now();
}

export function hasRecentDashboardActivity(): boolean {
  return Date.now() - lastActivityAt < ACTIVITY_TIMEOUT_MS;
}
