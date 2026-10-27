import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChild } from "../../src/runtime/trust/environment/backend.ts";
import { verifyEnvironment } from "../../src/runtime/trust/verify.ts";
import { NamespaceSandboxBackend } from "../../src/runtime/trust/environment/namespace.ts";
import { makeGrant, makeTrust } from "./_helpers.ts";

const roots: string[] = [];
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { force: true, recursive: true });
});
const raw = {
  argv: ["/bin/sh", "-c", "printf ok"],
  cwd: "/",
  env: { PATH: "/usr/bin:/bin" },
  timeoutMs: 1000,
  maxOutputBytes: 4096,
};

describe("RC-202 child bounds", () => {
  test.if(process.platform !== "win32")(
    "already-aborted or invalid-bound commands produce no marker",
    async () => {
      const ws = mkdtempSync(join(tmpdir(), "xr-cancel-"));
      roots.push(ws);
      const argv = ["/bin/sh", "-c", `echo bad > '${ws}/marker'`];
      const c = new AbortController();
      c.abort();
      expect(
        (await runChild({ ...raw, argv, signal: c.signal })).cancelled,
      ).toBe(true);
      expect(
        (await runChild({ ...raw, argv, timeoutMs: NaN })).spawnError,
      ).toContain("invalid");
      expect(existsSync(join(ws, "marker"))).toBe(false);
    },
  );
  test.if(process.platform !== "win32")(
    "UTF-8 output is bounded by bytes, not JS character count",
    async () => {
      const r = await runChild({
        ...raw,
        argv: ["/bin/sh", "-c", "while :; do printf '😀'; done"],
        maxOutputBytes: 65,
      });
      expect(r.outputTruncated).toBe(true);
      expect(r.killed).toBe(true);
      expect(
        Buffer.byteLength(r.stdout) + Buffer.byteLength(r.stderr),
      ).toBeLessThanOrEqual(65);
      expect(r.stdout).not.toContain("�");
    },
  );
  test("requested-but-unenforceable resources or expired grants refuse verification", () => {
    const backend = new NamespaceSandboxBackend();
    const grant = makeGrant();
    const verify = (g: typeof grant) =>
      verifyEnvironment({
        backend,
        expectedPlacement: "namespace_sandbox",
        tier: "tier2_isolated",
        exec: { ...raw, cwd: "/tmp/ws" },
        grant: g,
        credentialsSatisfied: true,
      });
    expect(
      verify({ ...grant, resources: { ...grant.resources, memoryBytes: NaN } })
        .verified,
    ).toBe(false);
    expect(verify({ ...grant, expiresAt: 0 }).verified).toBe(false);
    expect(
      verify({ ...grant, resources: { ...grant.resources, maxFiles: 100 } })
        .verified,
    ).toBe(false);
  });
  test.if(process.platform === "linux" && process.getuid?.() !== 0)(
    "injected output is scrubbed BEFORE broker revocation",
    async () => {
      const backend = new NamespaceSandboxBackend();
      if (!(await backend.detect()))
        throw new Error(
          "Linux isolation is required for credential-output regression",
        );
      const ws = mkdtempSync(join(tmpdir(), "xr-secret-output-"));
      roots.push(ws);
      const h = makeTrust([backend]);
      await h.manager.init();
      const value = "fixture-not-a-standard-key-shape-47591";
      const ref = h.broker.register("fixture_token", value, "test-execution");
      const grant = makeGrant({
        fs: {
          writableRoots: [ws],
          readOnlyRoots: [],
          blockedPaths: [],
          ephemeralScratch: true,
        },
        credentials: h.broker.scopeFor([ref], "task_scoped"),
      });
      const r = await h.manager.executeInEnvironment({
        decision: {
          kind: "admitted",
          requestedTier: "tier2_isolated",
          placement: "namespace_sandbox",
          reason: "test",
          decidedAt: Date.now(),
          policyVersion: "test",
        },
        exec: {
          ...raw,
          argv: ["/bin/sh", "-c", "printf '%s' \"$XR_CRED_FIXTURE_TOKEN\""],
          cwd: ws,
        },
        grant,
      });
      expect(r.blocked).toBe(false);
      expect(JSON.stringify(r)).not.toContain(value);
      if (!r.blocked) expect(r.output.result.stdout).toContain("REDACTED");
      expect(h.broker.activeCount()).toBe(0);
      await h.manager.shutdown();
    },
  );
});
