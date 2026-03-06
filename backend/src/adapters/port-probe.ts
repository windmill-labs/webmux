export interface PortProbe {
  isListening(port: number): Promise<boolean>;
}

export class BunPortProbe implements PortProbe {
  constructor(
    private readonly timeoutMs = 300,
    private readonly hostname = "127.0.0.1",
  ) {}

  isListening(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;

      const settle = (result: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => settle(false), this.timeoutMs);

      Bun.connect({
        hostname: this.hostname,
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
    });
  }
}
