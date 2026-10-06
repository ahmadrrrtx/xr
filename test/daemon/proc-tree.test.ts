/**
 * Phase 17 — process-tree termination.
 *
 * Regression for the orphaned dev server: stopping `npm run dev` must also
 * end the node process npm wrapped. We model the wrapper with `sh -c` and a
 * `sleep` grandchild: after `killTree`, neither may be alive.
 */
import { describe, expect, test } from "bun:test";

import { descendantsOf, isAlive, killTree, killTreeSync } from "../../src/daemon/proc-tree";

const posix = process.platform !== "win32";

async function spawnWrapper(): Promise<{ proc: Bun.Subprocess; child: number }> {
  // sh prints the pid of its background child, then keeps itself alive —
  // exactly the npm → shell → server shape, without needing npm in CI.
  const proc = Bun.spawn(["sh", "-c", "sleep 30 & echo $!; wait"], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  const child = Number(new TextDecoder().decode(value).trim());
  expect(Number.isFinite(child)).toBe(true);
  return { proc, child };
}

describe.if(posix)("proc-tree", () => {
  test("descendantsOf sees the grandchild through the shell", async () => {
    const { proc, child } = await spawnWrapper();
    try {
      // The shell may need a tick before the child shows up in /proc.
      let kids: number[] = [];
      for (let i = 0; i < 20 && !kids.includes(child); i += 1) {
        kids = descendantsOf(proc.pid);
        if (!kids.includes(child)) await new Promise((r) => setTimeout(r, 25));
      }
      expect(kids).toContain(child);
      expect(isAlive(child)).toBe(true);
    } finally {
      killTreeSync(proc.pid);
      await proc.exited;
    }
  });

  test("killTree ends the wrapper AND the orphan-to-be", async () => {
    const { proc, child } = await spawnWrapper();
    await killTree(proc.pid, 1_000);
    await proc.exited;
    // Give the kernel a moment to reap the grandchild (init adopts it).
    let alive = isAlive(child);
    for (let i = 0; i < 20 && alive; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
      alive = isAlive(child);
    }
    expect(alive).toBe(false);
    expect(isAlive(proc.pid)).toBe(false);
  });

  test("a plain SIGTERM of the wrapper alone would have orphaned the child (the bug)", async () => {
    const { proc, child } = await spawnWrapper();
    proc.kill("SIGTERM");
    await proc.exited;
    await new Promise((r) => setTimeout(r, 50));
    const orphaned = isAlive(child);
    killTreeSync(child); // clean up whichever way it went
    expect(orphaned).toBe(true);
  });

  test("killTree on a pid that is already gone resolves quietly", async () => {
    const proc = Bun.spawn(["sh", "-c", "exit 0"], { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
    await proc.exited;
    await expect(killTree(proc.pid, 200)).resolves.toBeUndefined();
    expect(descendantsOf(proc.pid)).toEqual([]);
  });
});
