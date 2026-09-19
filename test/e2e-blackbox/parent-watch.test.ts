/**
 * XR — e2e black-box: SEC-12 at the CLI boundary.
 *
 * The desktop shell launches the engine as `xr serve --port 0 --parent-pid
 * <shell pid>`. If the shell dies without cleaning up (crash, SIGKILL, OOM
 * kill), the engine must not stay behind as a token-authed daemon bound to
 * an ephemeral port until reboot.
 *
 * This test IS that scenario with the real CLI: a stand-in "shell" process
 * spawns the real daemon, the shell is SIGKILLed, and the daemon's port must
 * stop answering and its process must be gone — within seconds, on its own.
 *
 * The decision logic and the bare mechanism are covered in
 * test/daemon/parent-watch.test.ts; this file proves the wiring in
 * src/cli/router.ts (`serve` → startParentWatch → graceful stop).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { CLI_ENTRY, REPO_ROOT, freshHome, removeHome } from "./helpers.ts";
import { processAlive } from "../../src/daemon/parent-watch.ts";

/** Same policy as the other CLI-spawning files: the budget the lane promises. */
const T = 60_000;

const cleanup: Array<() => void> = [];
afterAll(() => {
  for (const fn of cleanup.splice(0)) fn();
});

async function portAnswers(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
    return res.status > 0;
  } catch {
    return false;
  }
}

describe("xr serve --parent-pid (SEC-12)", () => {
  test(
    "the daemon stops itself after its shell is SIGKILLed",
    async () => {
      const home = freshHome();
      cleanup.push(() => removeHome(home));

      const env: Record<string, string> = { ...process.env } as Record<string, string>;
      delete env.XR_AUDIT_NO_AUTOKEY;
      delete env.XR_AUDIT_SIGN_EVERY;
      env.XR_HOME = home;
      env.HOME = home;
      env.NO_COLOR = "1";

      // The stand-in shell: spawns the REAL daemon exactly as the desktop
      // shell does (its own pid as --parent-pid), reports the daemon's pid,
      // then idles. The daemon writes its banner straight to our pipe
      // (inherited stdout), so the shell's death does not take the pipe away.
      const shellScript = `
        const child = Bun.spawn([${JSON.stringify(process.execPath)}, "run", ${JSON.stringify(CLI_ENTRY)}, "serve", "--port", "0", "--parent-pid", String(process.pid)], {
          cwd: ${JSON.stringify(REPO_ROOT)},
          stdin: "ignore", stdout: "inherit", stderr: "inherit",
        });
        console.log("ENGINE_PID=" + child.pid);
        setInterval(() => {}, 1000);
      `;
      const shell = spawn(process.execPath, ["-e", shellScript], { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });

      let enginePid = 0;
      let stdoutBuf = "";
      let stderrBuf = "";
      shell.stdout!.on("data", (d) => {
        stdoutBuf += String(d);
      });
      shell.stderr!.on("data", (d) => {
        stderrBuf += String(d);
      });
      cleanup.push(() => {
        if (enginePid && processAlive(enginePid)) {
          try {
            process.kill(enginePid, "SIGKILL");
          } catch {
            /* gone */
          }
        }
        if (shell.exitCode === null) shell.kill("SIGKILL");
      });

      // Wait for both facts: the engine pid and the daemon's bound port.
      const bootBy = Date.now() + 45_000;
      let port = 0;
      while (Date.now() < bootBy) {
        const pm = stdoutBuf.match(/ENGINE_PID=(\d+)/);
        if (pm) enginePid = Number(pm[1]);
        const bm = stdoutBuf.match(/Listening on\s+http:\/\/127\.0\.0\.1:(\d+)/);
        if (bm) port = Number(bm[1]);
        if (enginePid && port) break;
        if (shell.exitCode !== null) throw new Error(`shell exited early: ${stderrBuf}`);
        await Bun.sleep(50);
      }
      expect(enginePid).toBeGreaterThan(0);
      expect(port).toBeGreaterThan(0);
      expect(await portAnswers(port)).toBe(true);

      // The crash. No signal handler runs, no RunEvent::Exit, no kill() call.
      shell.kill("SIGKILL");
      await new Promise<void>((resolve) => shell.once("exit", () => resolve()));

      // The daemon notices (1 s poll) and stops; allow generous slack for a
      // loaded runner but assert a real bound — an orphan is the bug.
      const goneBy = Date.now() + 8_000;
      while (Date.now() < goneBy && (await portAnswers(port))) await Bun.sleep(100);
      expect(await portAnswers(port)).toBe(false);

      const exitedBy = Date.now() + 5_000;
      while (Date.now() < exitedBy && processAlive(enginePid)) await Bun.sleep(100);
      expect(processAlive(enginePid)).toBe(false);

      // And it said why, on stderr, in the structured form the shell's W-5
      // tail captures.
      expect(stderrBuf).toContain('"event":"daemon.parent_gone"');
    },
    T,
  );
});
