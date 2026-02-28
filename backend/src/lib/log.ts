const DEBUG = Bun.env.WMDEV_DEBUG === "1";

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

export const log = {
  info(msg: string): void { console.log(`[${ts()}] ${msg}`); },
  debug(msg: string): void { if (DEBUG) console.log(`[${ts()}] ${msg}`); },
  warn(msg: string): void { console.warn(`[${ts()}] ${msg}`); },
  error(msg: string, err?: unknown): void {
    err !== undefined ? console.error(`[${ts()}] ${msg}`, err) : console.error(`[${ts()}] ${msg}`);
  },
};
