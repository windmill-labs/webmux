export interface DevPortPair {
  backendPort: number;
  frontendPort: number;
}

export type PortAvailabilityProbe = (port: number) => boolean;

export function selectDevPortPair(
  startPort: number,
  isAvailable: PortAvailabilityProbe,
  maxAttempts = 200,
): DevPortPair {
  for (let backendPort = startPort; backendPort < startPort + maxAttempts; backendPort++) {
    const frontendPort = backendPort + 1;
    if (isAvailable(backendPort) && isAvailable(frontendPort)) {
      return { backendPort, frontendPort };
    }
  }
  throw new Error(`Could not find two adjacent free ports starting at ${startPort}`);
}

function canBind(port: number): boolean {
  try {
    const server = Bun.serve({
      hostname: "0.0.0.0",
      port,
      fetch(): Response {
        return new Response();
      },
    });
    server.stop(true);
    return true;
  } catch (err: unknown) {
    if ((err as { code?: string } | null)?.code === "EADDRINUSE") return false;
    throw err;
  }
}

if (import.meta.main) {
  const startPort = parseInt(Bun.argv[2] ?? "5111", 10);
  if (Number.isNaN(startPort)) {
    console.error("Start port must be numeric");
    process.exit(1);
  }
  const pair = selectDevPortPair(startPort, canBind);
  console.log(`${pair.backendPort} ${pair.frontendPort}`);
}
