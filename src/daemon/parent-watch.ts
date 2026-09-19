/**
 * XR — engine parent death-watch (SEC-12).
 *
 * The desktop shell spawns the engine as a sidecar; the engine must never
 * outlive it. Where the OS offers an outside-in primitive the shell uses it
 * (Windows: Job Object with KILL_ON_JOB_CLOSE — W-2; Linux: PR_SET_PDEATHSIG
 * armed between fork and exec). macOS has no equivalent, and an outside-in
 * mechanism can fail at runtime (the shell reports that, it does not hide it).
 * So the engine ALSO watches its parent from the inside:
 *
 *     xr serve --parent-pid <pid>
 *
 * polls once per second and stops itself the moment the parent is gone. The
 * engine is the trusted layer here — a frontend cannot enforce this.
 *
 * "Gone" is decided by two independent facts, either of which suffices:
 *   1. we were the parent's direct child and our ppid changed — POSIX
 *      reparents orphans (to init or the nearest subreaper), which is immune
 *      to PID reuse. On Windows ppid never changes, so this fact is inert
 *      there (the Job Object is the Windows answer);
 *   2. a signal-0 probe reports ESRCH (no such process). EPERM means a process
 *      with that pid exists but is not ours — it counts as alive, never as
 *      gone, so a permission quirk can never stop a healthy engine.
 *
 * Nothing here keeps the event loop alive: the timer is unref'd, so a daemon
 * that is stopping for another reason is not held open by the watch.
 */

/** Facts the decision needs, injectable so the decision itself is unit-tested. */
export interface ParentWatchFacts {
  /** Current parent pid of this process. */
  ppid(): number;
  /** Whether a process with `pid` exists (signal-0 probe semantics). */
  alive(pid: number): boolean;
}

/** The real probe: `kill(pid, 0)`. ESRCH → gone; anything else → alive. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return code !== "ESRCH";
  }
}

export const REAL_FACTS: ParentWatchFacts = {
  ppid: () => process.ppid,
  alive: processAlive,
};

/**
 * Pure decision: is the watched parent gone?
 *
 * `initialPpid` is the ppid observed when the watch started. When it equals
 * the watched pid we were its direct child, and a later ppid change is proof
 * of death regardless of PID reuse. When it differs (a wrapper sits between
 * us and the watched process) only the existence probe applies.
 */
export function parentGone(pid: number, initialPpid: number, facts: ParentWatchFacts): boolean {
  if (initialPpid === pid && facts.ppid() !== pid) return true;
  return !facts.alive(pid);
}

export interface ParentWatchOptions {
  intervalMs?: number;
  facts?: ParentWatchFacts;
}

/**
 * Start watching `pid`; `onGone` fires exactly once. Returns a stop function.
 * The first check runs on the first tick, not synchronously, so a caller can
 * finish its own setup before the watch can fire.
 */
export function startParentWatch(pid: number, onGone: () => void, opts: ParentWatchOptions = {}): () => void {
  const facts = opts.facts ?? REAL_FACTS;
  const intervalMs = opts.intervalMs ?? 1000;
  const initialPpid = facts.ppid();
  let fired = false;
  const timer = setInterval(() => {
    if (fired) return;
    if (parentGone(pid, initialPpid, facts)) {
      fired = true;
      clearInterval(timer);
      onGone();
    }
  }, intervalMs);
  // Never hold the process open just to watch the parent.
  (timer as unknown as { unref?: () => void }).unref?.();
  return () => clearInterval(timer);
}

/**
 * `--parent-pid <pid>` / `--parent-pid=<pid>` → pid, `undefined` when absent.
 * Throws a plain Error for a malformed value (the CLI wraps it as a usage
 * error): a watch that silently never arms would be the dishonest failure.
 */
export function parseParentPid(args: string[], selfPid: number = process.pid): number | undefined {
  let raw: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--parent-pid") {
      raw = args[i + 1];
      if (raw === undefined) throw new Error("--parent-pid needs a value");
      break;
    }
    if (arg?.startsWith("--parent-pid=")) {
      raw = arg.slice("--parent-pid=".length);
      break;
    }
  }
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) throw new Error(`--parent-pid must be a positive integer, got "${raw}"`);
  const pid = Number.parseInt(raw, 10);
  if (pid <= 0 || !Number.isSafeInteger(pid)) throw new Error(`--parent-pid must be a positive integer, got "${raw}"`);
  if (pid === selfPid) throw new Error("--parent-pid cannot be the engine's own pid");
  return pid;
}
