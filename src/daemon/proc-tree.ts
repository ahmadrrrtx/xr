/**
 * Process-tree termination for daemon-owned children (Phase 17).
 *
 * `npm run dev` is a wrapper: npm → `sh -c vite …` → node. Signalling only
 * the top pid ends npm and the shell, and the real server is re-parented to
 * init with its port still open — the next start lands on 5174 and the
 * "stopped" the UI reports is a lie. So every stop enumerates descendants
 * FIRST (the parent link is lost once the parent dies), then signals the
 * whole set. Linux reads /proc (no subprocess); other POSIX hosts ask `ps`;
 * Windows uses `taskkill /T`, which walks the tree itself.
 */

import { readdirSync, readFileSync } from "node:fs";

function parentMapFromProc(): Map<number, number[]> | null {
  const byParent = new Map<number, number[]>();
  let names: string[];
  try {
    names = readdirSync("/proc");
  } catch {
    return null;
  }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    let stat: string;
    try {
      stat = readFileSync(`/proc/${name}/stat`, "utf8");
    } catch {
      continue; // raced with exit
    }
    // "pid (comm) state ppid …" — comm may contain spaces or parens.
    const close = stat.lastIndexOf(")");
    const fields = stat.slice(close + 2).split(" ");
    const ppid = Number(fields[1]);
    if (!Number.isFinite(ppid)) continue;
    const list = byParent.get(ppid) ?? [];
    list.push(Number(name));
    byParent.set(ppid, list);
  }
  return byParent;
}

function parentMapFromPs(): Map<number, number[]> {
  const byParent = new Map<number, number[]>();
  try {
    const out = Bun.spawnSync(["ps", "-eo", "pid=,ppid="], { stdout: "pipe", stderr: "ignore" });
    for (const line of out.stdout.toString().split("\n")) {
      const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
      if (!m) continue;
      const list = byParent.get(Number(m[2])) ?? [];
      list.push(Number(m[1]));
      byParent.set(Number(m[2]), list);
    }
  } catch {
    /* no ps — only the top pid can be signalled */
  }
  return byParent;
}

/** All live descendants of `pid`, breadth-first (parents before children). */
export function descendantsOf(pid: number): number[] {
  if (process.platform === "win32") return [];
  const byParent = (process.platform === "linux" ? parentMapFromProc() : null) ?? parentMapFromPs();
  const found: number[] = [];
  const queue = [pid];
  const seen = new Set<number>([pid]);
  while (queue.length) {
    const p = queue.shift() as number;
    for (const c of byParent.get(p) ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      found.push(c);
      queue.push(c);
    }
  }
  return found;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = exists but not ours; anything else = gone.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export type TreeSignal = "SIGTERM" | "SIGKILL";

/**
 * Signal `pid` and every pid in `kids` (deepest first, so a supervising
 * parent cannot respawn what we just ended). Pass the list captured by
 * `descendantsOf` before the first signal.
 */
export function signalTree(pid: number, kids: readonly number[], signal: TreeSignal): void {
  if (process.platform === "win32") {
    try {
      Bun.spawnSync(["taskkill", "/pid", String(pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" });
    } catch {
      /* gone */
    }
    return;
  }
  for (const k of [...kids].reverse()) {
    try {
      process.kill(k, signal);
    } catch {
      /* gone */
    }
  }
  try {
    process.kill(pid, signal);
  } catch {
    /* gone */
  }
}

/**
 * SIGTERM the tree, give it `graceMs` to leave, then SIGKILL whatever is
 * left. Resolves when nothing in the captured tree is alive (or after the
 * SIGKILL has been sent).
 */
export async function killTree(pid: number, graceMs: number): Promise<void> {
  const kids = descendantsOf(pid);
  signalTree(pid, kids, "SIGTERM");
  const all = [pid, ...kids];
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!all.some(isAlive)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (all.some(isAlive)) signalTree(pid, kids, "SIGKILL");
}

/** Synchronous last resort for `process.exit` handlers. */
export function killTreeSync(pid: number): void {
  signalTree(pid, descendantsOf(pid), "SIGKILL");
}
