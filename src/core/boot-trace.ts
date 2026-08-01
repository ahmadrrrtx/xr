/**
 * XR Phase 3 · T1 — Boot trace.
 *
 * Lightweight timing instrumentation for command-scoped boot. Records phase
 * durations (kernel-import → register/init → start → execute → shutdown) for
 * the current CLI invocation.
 *
 * - When XR_TRACE_BOOT=1, the finished trace is printed as one JSON line to
 *   stderr on shutdown — a built-in boot-profile view for diagnosing slow
 *   commands (Part 21 · DX).
 * - Tests can `resetBootTrace()` and read `bootTrace.snapshot()` to assert
 *   subsystems-per-command (Part 10 · boot-profile tests).
 *
 * The trace is process-local and best-effort: it never throws, never writes
 * secrets (it records durations and provider ids only — Part 20).
 */

export interface BootTraceSnapshot {
  command?: string;
  profile: string[] | null;
  bootedProviders: string[];
  loadedCommands: string[];
  phases: Array<{ phase: string; ms: number }>;
  totalMs: number;
}

class BootTrace {
  private started = performance.now();
  private last = this.started;
  private phases: Array<{ phase: string; ms: number }> = [];
  private command: string | undefined;
  private profile: string[] | null = null;
  private bootedProviders: string[] = [];
  private loadedCommands: string[] = [];

  begin(command: string): void {
    this.command = command;
    this.started = performance.now();
    this.last = this.started;
    this.phases = [];
  }

  mark(phase: string): void {
    const now = performance.now();
    this.phases.push({ phase, ms: now - this.last });
    this.last = now;
  }

  setProfile(profile: string[] | null, bootedProviders: string[]): void {
    this.profile = profile;
    this.bootedProviders = bootedProviders;
  }

  noteLoadedCommand(name: string): void {
    if (!this.loadedCommands.includes(name)) this.loadedCommands.push(name);
  }

  snapshot(): BootTraceSnapshot {
    return {
      command: this.command,
      profile: this.profile,
      bootedProviders: this.bootedProviders,
      loadedCommands: this.loadedCommands,
      phases: [...this.phases],
      totalMs: performance.now() - this.started,
    };
  }

  /** Emit the trace as one JSON line to stderr when XR_TRACE_BOOT=1. */
  emit(): void {
    if (process.env.XR_TRACE_BOOT !== "1") return;
    try {
      console.error(`XR_BOOT_TRACE ${JSON.stringify(this.snapshot())}`);
    } catch {
      /* trace must never break the CLI */
    }
  }

  reset(): void {
    this.started = performance.now();
    this.last = this.started;
    this.phases = [];
    this.command = undefined;
    this.profile = null;
    this.bootedProviders = [];
    this.loadedCommands = [];
  }
}

export const bootTrace = new BootTrace();
export function resetBootTrace(): void {
  bootTrace.reset();
}
