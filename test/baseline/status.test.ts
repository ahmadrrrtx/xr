import { describe, expect, test } from "bun:test";
import { redactValue, safeConfigStatus, summarizeHealthChecks, workspaceStatus } from "../../src/enterprise/baseline/status.ts";

const checks = [
  { id: "platform", label: "Platform", state: "ok" as const, detail: "linux/x64" },
  { id: "bun", label: "Bun", state: "ok" as const, detail: "1.3.14" },
  { id: "package-manager", label: "Package", state: "ok" as const, detail: "bun" },
  { id: "config", label: "Config", state: "ok" as const, detail: "ok" },
  { id: "audit", label: "Audit", state: "ok" as const, detail: "ok" },
  { id: "local-runtime", label: "Local runtime", state: "warn" as const, detail: "not running" },
  { id: "network", label: "Network", state: "skip" as const, detail: "not probed" },
];

/** A reachable provider — the difference between "installed" and "can work". */
const readyProvider = { id: "provider-ollama", label: "Provider: ollama", state: "ok" as const, detail: "reachable" };

describe("Phase 0 baseline status helpers", () => {
  /**
   * Phase 0 · T4 — this test was updated deliberately.
   *
   * It previously asserted `ok: true` for a check set containing NO provider,
   * which is exactly the false green the phase exists to remove: XR reported
   * itself healthy while being unable to complete a single task. The summary
   * now answers two separate questions, and the test covers both.
   */
  test("installation-health mode allows optional warnings but fails required checks", () => {
    const warnOnly = summarizeHealthChecks(checks, undefined, { requireRunnable: false });
    expect(warnOnly.ok).toBe(true);
    expect(warnOnly.state).toBe("warn");
    expect(warnOnly.exitCode).toBe(0);
    expect(warnOnly.warnings).toContain("local-runtime");

    const requiredFail = summarizeHealthChecks(
      checks.map((c) => (c.id === "audit" ? { ...c, state: "fail" as const } : c)),
      undefined,
      { requireRunnable: false },
    );
    expect(requiredFail.ok).toBe(false);
    expect(requiredFail.state).toBe("fail");
    expect(requiredFail.exitCode).toBe(1);
    expect(requiredFail.requiredFailures).toEqual(["audit"]);
  });

  test("readiness mode is NOT ok when no provider can run a task", () => {
    const summary = summarizeHealthChecks(checks);
    expect(summary.ok).toBe(false);
    expect(summary.runnable).toBe(false);
    expect(summary.exitCode).toBe(1);
    expect(summary.runnableReason).toMatch(/no provider/i);
  });

  test("readiness mode is ok once a provider is reachable", () => {
    const summary = summarizeHealthChecks([...checks, readyProvider]);
    expect(summary.ok).toBe(true);
    expect(summary.runnable).toBe(true);
    expect(summary.exitCode).toBe(0);
    expect(summary.runnableReason).toContain("ollama");
  });

  test("a configured-but-unreachable provider is not runnable (fail closed)", () => {
    const summary = summarizeHealthChecks([
      ...checks,
      { id: "provider-openai", label: "Provider: openai", state: "warn" as const, detail: "auth ok, unreachable" },
    ]);
    expect(summary.runnable).toBe(false);
    expect(summary.ok).toBe(false);
    expect(summary.runnableReason).toMatch(/configured but unavailable/i);
  });

  test("a required failure outranks a reachable provider", () => {
    const summary = summarizeHealthChecks([
      ...checks.map((c) => (c.id === "audit" ? { ...c, state: "fail" as const } : c)),
      readyProvider,
    ]);
    expect(summary.ok).toBe(false);
    expect(summary.runnable).toBe(false);
    expect(summary.requiredFailures).toEqual(["audit"]);
  });

  test("redactValue redacts secret-like keys recursively", () => {
    const redacted = redactValue("root", {
      apiKey: "sk-test",
      nested: { token: "abc", regular: "visible" },
      list: [{ password: "pw" }],
    }) as any;
    expect(redacted.apiKey).toBe("[REDACTED]");
    expect(redacted.nested.token).toBe("[REDACTED]");
    expect(redacted.nested.regular).toBe("visible");
    expect(redacted.list[0].password).toBe("[REDACTED]");
  });

  test("safeConfigStatus reports secret presence without values", () => {
    const oldSet = process.env.XR_PHASE0_TEST_SECRET_SET;
    const oldUnset = process.env.XR_PHASE0_TEST_SECRET_UNSET;
    process.env.XR_PHASE0_TEST_SECRET_SET = "sk-never-print";
    delete process.env.XR_PHASE0_TEST_SECRET_UNSET;
    try {
      const status = safeConfigStatus({
        path: "/tmp/xr/config.json",
        warnings: [],
        providerKeyEnvs: ["XR_PHASE0_TEST_SECRET_SET", "XR_PHASE0_TEST_SECRET_UNSET"],
        config: {
          defaults: { mode: "agent", provider: "ollama", model: "qwen" },
          budget: { perTaskUsd: 0.25, perTaskTokens: 1000 },
          memory: { enabled: true, injectInChat: true, recallLimit: 5 },
          security: { requireApproval: ["shell"], egressAllowlist: ["example.com"] },
          localModels: { enabled: false, runtime: "ollama", routing: "hybrid" },
        },
      });
      expect(status.secrets.XR_PHASE0_TEST_SECRET_SET).toBe("set");
      expect(status.secrets.XR_PHASE0_TEST_SECRET_UNSET).toBe("unset");
      expect(JSON.stringify(status)).not.toContain("sk-never-print");
    } finally {
      if (oldSet === undefined) delete process.env.XR_PHASE0_TEST_SECRET_SET;
      else process.env.XR_PHASE0_TEST_SECRET_SET = oldSet;
      if (oldUnset === undefined) delete process.env.XR_PHASE0_TEST_SECRET_UNSET;
      else process.env.XR_PHASE0_TEST_SECRET_UNSET = oldUnset;
    }
  });

  test("workspaceStatus is deterministic for missing database", () => {
    const status = workspaceStatus({ id: "default", rootDir: "/tmp/xr", configPath: "/tmp/xr/config.json", dbPath: "/definitely/missing/xr.db", connectionCount: 1 });
    expect(status.dbExists).toBe(false);
    expect(status.dbSizeBytes).toBeNull();
  });
});
