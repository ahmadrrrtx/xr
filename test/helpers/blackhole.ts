/**
 * Phase 01 test helper — blackhole TCP servers on the local-runtime ports.
 *
 * Reproduces the forensic "slow-failing probe" environment: the ports ACCEPT
 * connections but never answer, so HTTP probes burn their full AbortSignal
 * timeout instead of failing instantly with ECONNREFUSED. This is what turns
 * the old sequential detection into ~25-30 s and the old health probes into
 * 8-16 s stalls.
 *
 * Returns null when a port cannot be bound (e.g. a real local runtime is
 * running on this machine) — callers should skip rather than fail.
 */

export const RUNTIME_PORTS = [11434, 1234, 8080, 1337, 8000, 4891, 5001, 5000, 30000];

export interface BlackholeHandle {
  ports: number[];
  stop(): void;
}

/** Start blackhole servers on every local-runtime port. */
export function startBlackhole(): BlackholeHandle | null {
  const servers: Array<{ port: number; stop(): void }> = [];
  const BunRef = (globalThis as { Bun?: any }).Bun;
  if (!BunRef?.serve) return null;
  for (const port of RUNTIME_PORTS) {
    try {
      const server = BunRef.serve({
        port,
        hostname: "127.0.0.1",
        fetch() {
          // Accept and never answer — the client's own timeout decides.
          return new Promise(() => {});
        },
      });
      servers.push({ port: server.port ?? port, stop: () => server.stop() });
    } catch {
      // Port busy (real runtime on this host): stop what we have and bail.
      for (const s of servers) {
        try {
          s.stop();
        } catch {
          /* ignore */
        }
      }
      return null;
    }
  }
  return {
    ports: servers.map((s) => s.port),
    stop() {
      for (const s of servers) {
        try {
          s.stop();
        } catch {
          /* ignore */
        }
      }
    },
  };
}
