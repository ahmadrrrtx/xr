/**
 * XR — SEC-12 mechanism: a SIGKILLed parent takes its watching child with it.
 *
 * A real process tree: a parent process spawns a child that watches it (the
 * parent's pid passed explicitly, exactly as the desktop shell passes its pid
 * to the engine); the parent is killed with SIGKILL — no handler, no cleanup,
 * the crash case; the child must notice on its own and leave.
 *
 * POSIX only (test/platform/exclusions.json): on Windows a crashed shell's
 * engine is killed by the Job Object (W-2, `cargo test` on the Windows
 * runner), and libuv's own per-process job takes a spawned grandchild down
 * with its parent before an in-process watch could ever observe anything —
 * so this scenario cannot be staged there. On macOS this watch is the ONLY
 * crash-path guarantee, which is why this file runs in the macOS parity lane.
 */

import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processAlive } from "../../src/daemon/parent-watch.ts";

describe("SEC-12 mechanism — a SIGKILLed parent takes its watching child with it", () => {
  const T = 30_000;

  test(
    "child leaves within 5 s of the parent's uncatchable death",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "xr-parent-watch-"));
      const marker = join(dir, "gone.txt");
      const modulePath = join(import.meta.dir, "..", "..", "src", "daemon", "parent-watch.ts");

      const armed = join(dir, "armed.txt");

      // The CHILD: is told the parent's pid explicitly (exactly as the shell
      // tells the engine — never "whatever my ppid is right now", which would
      // watch init if the parent were already gone). Writes `armed` once the
      // watch is running, `marker` when the parent is gone, then exits.
      const childScript = `
        const { startParentWatch } = await import(${JSON.stringify(modulePath)});
        const { writeFileSync } = await import("node:fs");
        const parentPid = Number(process.argv[1]);
        startParentWatch(parentPid, () => {
          writeFileSync(${JSON.stringify(marker)}, String(parentPid));
          process.exit(0);
        }, { intervalMs: 100 });
        writeFileSync(${JSON.stringify(armed)}, String(process.pid));
        setInterval(() => {}, 1000);
      `;
      // The PARENT: spawns the child with its own pid, reports the child's
      // pid, then idles until killed.
      const parentScript = `
        const child = Bun.spawn([${JSON.stringify(process.execPath)}, "-e", ${JSON.stringify(childScript)}, String(process.pid)], {
          stdin: "ignore", stdout: "ignore", stderr: "inherit",
        });
        console.log("CHILD_PID=" + child.pid);
        setInterval(() => {}, 1000);
      `;

      const parent = spawn(process.execPath, ["-e", parentScript], { stdio: ["ignore", "pipe", "inherit"] });
      let childPid = 0;
      try {
        childPid = await new Promise<number>((resolve, reject) => {
          let buf = "";
          parent.stdout!.on("data", (d) => {
            buf += String(d);
            const m = buf.match(/CHILD_PID=(\d+)/);
            if (m) resolve(Number(m[1]));
          });
          parent.once("exit", (code) => reject(new Error(`parent exited early (${code})`)));
          setTimeout(() => reject(new Error("no CHILD_PID within 10 s")), 10_000);
        });
        expect(processAlive(childPid)).toBe(true);

        // The shell is alive while the engine boots: wait until the watch is armed.
        const armedBy = Date.now() + 10_000;
        while (Date.now() < armedBy && !existsSync(armed)) await Bun.sleep(25);
        expect(existsSync(armed)).toBe(true);
        expect(existsSync(marker)).toBe(false); // parent alive → nothing fired

        // The crash: SIGKILL cannot be caught or cleaned up after.
        parent.kill("SIGKILL");
        await new Promise<void>((resolve) => parent.once("exit", () => resolve()));

        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline && !existsSync(marker)) await Bun.sleep(50);
        expect(existsSync(marker)).toBe(true);
        expect(readFileSync(marker, "utf8")).toBe(String(parent.pid));

        // And the child really is gone, not merely announced.
        const gone = Date.now() + 3_000;
        while (Date.now() < gone && processAlive(childPid)) await Bun.sleep(50);
        expect(processAlive(childPid)).toBe(false);
      } finally {
        if (childPid && processAlive(childPid)) {
          try {
            process.kill(childPid, "SIGKILL");
          } catch {
            /* already gone */
          }
        }
        rmSync(dir, { recursive: true, force: true });
      }
    },
    T,
  );
});
