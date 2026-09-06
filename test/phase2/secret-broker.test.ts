/**
 * XR Phase 2 · F-24 — SECRET BROKER SEAM tests.
 *
 *   [Unit]  flag semantics: XR_SECRETS_ENV_COMPAT defaults ON for 1.0; only
 *           explicit off-values disable ambient hydration (pure predicate —
 *           no process.env mutation, safe under bun's shared-env threads)
 *   [Child] compat ON  — the 1.0 posture runs in a CHILD process (hermetic
 *           spawn env): setSecret hydrates process.env, the broker resolves,
 *           hydrateProviderEnv writes env
 *   [Child] compat OFF — the 2.0 posture runs in a CHILD process whose own
 *           module-load snapshot sees the flag off: setSecret persists
 *           durably but never lands in env, the broker still resolves,
 *           hydrateProviderEnv is a no-op, and an ambient env value loses to
 *           the durable answer.
 *
 * Nothing in this file mutates shared process.env: `bun test` runs test files
 * in threads that share it, so a mutation here would change secret behavior
 * for every other file running in parallel.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isOffValue, resolvePosture } from "../../src/security/env-compat.ts";

describe("Phase 8 posture resolution (pure, no env mutation)", () => {
  test("DEFAULT: hydration OFF (F-24 closed), ambient read ON (BYOK works)", () => {
    const p = resolvePosture({});
    expect(p.hydration).toBe(false);
    expect(p.ambientRead).toBe(true);
  });

  test("XR_SECRETS_ENV_HYDRATION=1 re-enables the ambient mirror (explicit opt-in)", () => {
    expect(resolvePosture({ XR_SECRETS_ENV_HYDRATION: "1" }).hydration).toBe(true);
  });

  test("XR_SECRETS_STRICT=1 seals BOTH directions", () => {
    const p = resolvePosture({ XR_SECRETS_STRICT: "1" });
    expect(p.hydration).toBe(false);
    expect(p.ambientRead).toBe(false);
  });

  test("XR_SECRETS_ENV_READ=0 disables BYOK without enabling hydration", () => {
    const p = resolvePosture({ XR_SECRETS_ENV_READ: "0" });
    expect(p.ambientRead).toBe(false);
    expect(p.hydration).toBe(false);
  });

  test("legacy XR_SECRETS_ENV_COMPAT=0 still means the sealed posture", () => {
    const p = resolvePosture({ XR_SECRETS_ENV_COMPAT: "0" });
    expect(p.hydration).toBe(false);
    expect(p.ambientRead).toBe(false);
  });

  test("legacy XR_SECRETS_ENV_COMPAT=1 restores hydration and is flagged as legacy", () => {
    const p = resolvePosture({ XR_SECRETS_ENV_COMPAT: "1" });
    expect(p.hydration).toBe(true);
    expect(p.legacyFlagUsed).toBe(true);
  });
});

describe("flag semantics (pure predicate, no env mutation)", () => {
  test("defaults ON for 1.0 (unset / empty)", () => {
    expect(isOffValue(undefined)).toBe(false);
    expect(isOffValue("")).toBe(false);
    expect(isOffValue("   ")).toBe(false);
  });

  test("explicit off-values disable ambient hydration", () => {
    for (const off of ["0", "false", "off", "False", " OFF "]) {
      expect(isOffValue(off)).toBe(true);
    }
  });

  test("on-values and typos keep 1.0 behavior (fail-safe toward working providers)", () => {
    for (const on of ["1", "true", "on", "TRUE", "yolo"]) {
      expect(isOffValue(on)).toBe(false);
    }
  });
});

/** Run one hermetic fixture child and return its single JSON line. */
async function runFixture(fixture: string, extraEnv: Record<string, string>): Promise<Record<string, unknown>> {
  const proc = Bun.spawn({
    // process.execPath (not a bare "bun") so the child spawn resolves the
    // exact same binary on every platform (Windows-safe).
    cmd: [process.execPath, "run", join(import.meta.dir, "fixtures", fixture)],
    stdout: "pipe",
    stderr: "inherit",
    env: {
      ...process.env,
      XR_HOME: join(mkdtempSync(join(tmpdir(), "xr-p2-sec-")), "home"),
      ...extraEnv,
    },
  });
  // Watchdog: a fixture child that fails to exit (a lingering event-loop
  // handle / async secret backend, observed on Windows) must never hang the
  // whole suite. Kill it and surface a loud error instead of a 30-min stall.
  const watchdog = setTimeout(() => {
    try {
      proc.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }, 20_000);
  (watchdog as unknown as { unref?: () => void }).unref?.();
  try {
    const out = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    clearTimeout(watchdog);
    if (exitCode !== 0) {
      throw new Error(`fixture ${fixture} exited with code ${exitCode}`);
    }
    const lines = out.trim().split("\n").filter((l) => l.trim().length > 0);
    return JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown>;
  } catch (err) {
    clearTimeout(watchdog);
    try {
      proc.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    throw err;
  }
}

describe("hydration ON (explicit opt-in, hermetic child process)", () => {
  test("setSecret hydrates process.env; broker sync + async resolve; hydrateProviderEnv writes", async () => {
    const r = await runFixture("secret-compat-on.ts", { XR_SECRETS_ENV_HYDRATION: "1" });
    expect(r.flagEnabled).toBe(true);
    expect(r.envAfterSet).toBe("v1-secret");
    expect(r.synced).toBe("v1-secret");
    expect(r.asynced).toBe("v5-secret");
    expect(r.envAfterHydrate).toBe("v2-secret");
  }, 30_000);
});

describe("sealed posture (hermetic child process)", () => {
  test("setSecret persists durably but NEVER lands in env; broker still resolves", async () => {
    const r = await runFixture("secret-compat-off.ts", { XR_SECRETS_STRICT: "1" });

    // The child's own snapshot sees the flag off.
    expect(r.flagEnabled).toBe(false);
    // setSecret wrote the durable store but never hydrated process.env…
    expect(r.envAfterSet).toBeUndefined();
    // …and both broker paths still resolve through the durable backend.
    expect(r.synced).toBe("v3-secret");
    expect(r.asynced).toBe("v3-secret");
    expect(r.envAfterResolve).toBeUndefined();
    // hydrateProviderEnv is a no-op when compat is off.
    expect(r.envAfterHydrate).toBeUndefined();
    // An ambient env value loses to the durable answer.
    expect(r.ambientWins).toBe("durable");
  }, 30_000);
});
