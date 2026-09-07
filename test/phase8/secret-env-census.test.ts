/**
 * XR Phase 8 · XR803 — with compat OFF, storing a provider key must not
 * hydrate process.env. Hermetic child (module-load snapshot).
 */
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("compat off: setSecret does not land OPENAI_API_KEY in process.env", async () => {
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", join(import.meta.dir, "fixtures", "secret-env-off.ts")],
    stdout: "pipe",
    stderr: "inherit",
    env: {
      ...process.env,
      XR_HOME: join(mkdtempSync(join(tmpdir(), "xr-p8-env-")), "home"),
      XR_SECRETS_ENV_COMPAT: "0",
    },
  });
  const watchdog = setTimeout(() => {
    try { proc.kill("SIGKILL"); } catch { /* gone */ }
  }, 20_000);
  (watchdog as unknown as { unref?: () => void }).unref?.();
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  clearTimeout(watchdog);
  expect(code).toBe(0);
  const json = JSON.parse(out.trim().split("\n").filter(Boolean).pop()!) as Record<string, unknown>;
  expect(json.compat).toBe(false);
  expect(json.env).toBeUndefined();
  expect(json.stored).toBe("sk-phase8-not-in-env");
  expect(json.broker).toBe("sk-phase8-not-in-env");
}, 20_000);
