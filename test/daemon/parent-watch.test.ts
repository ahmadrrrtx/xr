/**
 * XR — SEC-12: the engine's parent death-watch (decision, probe, flag, loop).
 *
 * Runs on every OS. The DECISION (`parentGone`) is pure and is exercised over
 * its whole truth table with injected facts; the PROBE (`processAlive`) is
 * exercised against real pids — on Windows too, where it is the fact the
 * watch depends on (ppid never changes there).
 *
 * The process-tree proof (a SIGKILLed parent takes its watching child with
 * it) is test/daemon/parent-watch-mechanism.test.ts; the CLI-boundary proof
 * (`xr serve --parent-pid` really stops the daemon) is
 * test/e2e-blackbox/parent-watch.test.ts.
 */

import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  parentGone,
  parseParentPid,
  processAlive,
  startParentWatch,
  type ParentWatchFacts,
} from "../../src/daemon/parent-watch.ts";

const facts = (ppid: number, alive: boolean): ParentWatchFacts => ({ ppid: () => ppid, alive: () => alive });

describe("parentGone — the decision", () => {
  test("direct child, ppid unchanged, parent alive → not gone", () => {
    expect(parentGone(100, 100, facts(100, true))).toBe(false);
  });

  test("direct child, ppid changed → gone even if a process with that pid still 'exists' (PID reuse)", () => {
    expect(parentGone(100, 100, facts(1, true))).toBe(true);
  });

  test("direct child, ppid unchanged but probe says ESRCH → gone (zombie reaped without reparent visibility)", () => {
    expect(parentGone(100, 100, facts(100, false))).toBe(true);
  });

  test("wrapper in between (not our direct parent): only the existence probe decides", () => {
    expect(parentGone(100, 55, facts(55, true))).toBe(false);
    expect(parentGone(100, 55, facts(55, false))).toBe(true);
    // Our own ppid changing is irrelevant when the watched pid was never our parent.
    expect(parentGone(100, 55, facts(1, true))).toBe(false);
  });
});

describe("processAlive — the real probe", () => {
  test("our own pid is alive", () => {
    expect(processAlive(process.pid)).toBe(true);
  });

  test("a pid that has exited is not alive", async () => {
    const child = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
    const pid = child.pid!;
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    expect(processAlive(pid)).toBe(false);
  });

  test("EPERM counts as alive: a permission quirk must never stop a healthy engine", () => {
    // Decision-level: the probe maps only ESRCH to "gone".
    const eperm: ParentWatchFacts = {
      ppid: () => 55,
      alive: () => true, // what processAlive returns for EPERM
    };
    expect(parentGone(100, 55, eperm)).toBe(false);
  });
});

describe("parseParentPid — the flag", () => {
  test("absent → undefined", () => {
    expect(parseParentPid(["--port", "0"])).toBeUndefined();
  });

  test("both spellings", () => {
    expect(parseParentPid(["--parent-pid", "4242"], 1)).toBe(4242);
    expect(parseParentPid(["--parent-pid=4242"], 1)).toBe(4242);
    expect(parseParentPid(["--port", "0", "--parent-pid", "4242"], 1)).toBe(4242);
  });

  test("malformed values throw — a watch that silently never arms is the dishonest failure", () => {
    expect(() => parseParentPid(["--parent-pid"])).toThrow(/needs a value/);
    expect(() => parseParentPid(["--parent-pid", "abc"])).toThrow(/positive integer/);
    expect(() => parseParentPid(["--parent-pid", "-5"])).toThrow(/positive integer/);
    expect(() => parseParentPid(["--parent-pid", "0"])).toThrow(/positive integer/);
    expect(() => parseParentPid(["--parent-pid", "1.5"])).toThrow(/positive integer/);
    expect(() => parseParentPid(["--parent-pid", String(process.pid)])).toThrow(/own pid/);
  });
});

describe("startParentWatch — the loop", () => {
  test("fires exactly once, after the first tick, and stop() disarms it", async () => {
    let alive = true;
    let fired = 0;
    const stop = startParentWatch(100, () => fired++, {
      intervalMs: 5,
      facts: { ppid: () => 100, alive: () => alive },
    });
    await Bun.sleep(30);
    expect(fired).toBe(0); // parent alive → nothing happens
    alive = false;
    await Bun.sleep(40);
    expect(fired).toBe(1); // gone → fired
    await Bun.sleep(30);
    expect(fired).toBe(1); // and never again
    stop();
  });

  test("stop() before the parent goes → never fires", async () => {
    let fired = 0;
    const stop = startParentWatch(100, () => fired++, {
      intervalMs: 5,
      facts: { ppid: () => 100, alive: () => true },
    });
    stop();
    await Bun.sleep(30);
    expect(fired).toBe(0);
  });
});
