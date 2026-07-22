import { describe, expect, test } from "bun:test";
import { redactValue, safeConfigStatus, summarizeHealthChecks, workspaceStatus } from "../../src/baseline/status.ts";

const checks = [
  { id: "platform", label: "Platform", state: "ok" as const, detail: "linux/x64" },
  { id: "bun", label: "Bun", state: "ok" as const, detail: "1.3.14" },
  { id: "package-manager", label: "Package", state: "ok" as const, detail: "bun" },
  { id: "config", label: "Config", state: "ok" as const, detail: "ok" },
  { id: "audit", label: "Audit", state: "ok" as const, detail: "ok" },
  { id: "local-runtime", label: "Local runtime", state: "warn" as const, detail: "not running" },
  { id: "network", label: "Network", state: "skip" as const, detail: "not probed" },
];

describe("Phase 0 baseline status helpers", () => {
  test("summarizeHealthChecks allows optional warnings but fails required checks", () => {
    const warnOnly = summarizeHealthChecks(checks);
    expect(warnOnly.ok).toBe(true);
    expect(warnOnly.state).toBe("warn");
    expect(warnOnly.exitCode).toBe(0);
    expect(warnOnly.warnings).toContain("local-runtime");

    const requiredFail = summarizeHealthChecks(checks.map((c) => c.id === "audit" ? { ...c, state: "fail" as const } : c));
    expect(requiredFail.ok).toBe(false);
    expect(requiredFail.state).toBe("fail");
    expect(requiredFail.exitCode).toBe(1);
    expect(requiredFail.requiredFailures).toEqual(["audit"]);
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
    const old = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-never-print";
    try {
      const status = safeConfigStatus({
        path: "/tmp/xr/config.json",
        warnings: [],
        providerKeyEnvs: ["OPENAI_API_KEY", "GROQ_API_KEY"],
        config: {
          defaults: { mode: "agent", provider: "ollama", model: "qwen" },
          budget: { perTaskUsd: 0.25, perTaskTokens: 1000 },
          memory: { enabled: true, injectInChat: true, recallLimit: 5 },
          security: { requireApproval: ["shell"], egressAllowlist: ["example.com"] },
          localModels: { enabled: false, runtime: "ollama", routing: "hybrid" },
        },
      });
      expect(status.secrets.OPENAI_API_KEY).toBe("set");
      expect(status.secrets.GROQ_API_KEY).toBe("unset");
      expect(JSON.stringify(status)).not.toContain("sk-never-print");
    } finally {
      if (old === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = old;
    }
  });

  test("workspaceStatus is deterministic for missing database", () => {
    const status = workspaceStatus({ id: "default", rootDir: "/tmp/xr", configPath: "/tmp/xr/config.json", dbPath: "/definitely/missing/xr.db", connectionCount: 1 });
    expect(status.dbExists).toBe(false);
    expect(status.dbSizeBytes).toBeNull();
  });
});
