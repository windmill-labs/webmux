export interface PortProbe {
  isListening(port: number): Promise<boolean>;
}

export class BunPortProbe implements PortProbe {
  constructor(
    private readonly timeoutMs = 300,
    private readonly hostnames: readonly string[] = ["127.0.0.1", "::1"],
  ) {}

  isListening(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      let pending = this.hostnames.length;

      const settle = (result: boolean): void => {
        if (settled) return;
        if (result) {
          settled = true;
          clearTimeout(timer);
          resolve(true);
          return;
        }
        pending--;
        if (pending === 0) {
          settled = true;
          clearTimeout(timer);
          resolve(false);
        }
      };

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }, this.timeoutMs);

      for (const hostname of this.hostnames) {
        Bun.connect({
          hostname,
          port,
          socket: {
            open(socket) {
              socket.end();
              settle(true);
            },
            error() {
              settle(false);
            },
            data() {},
          },
        }).catch(() => settle(false));
      }
    });
  }
}
