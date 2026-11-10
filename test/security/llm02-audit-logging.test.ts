import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../../src/state/workspace-store.ts";
import { buildAuditReport, verifyAuditReport } from "../../src/export/report.ts";
import { structuredLog, setLogWriter } from "../../src/observability/logs.ts";

// Clearly synthetic fixtures, never real credentials.
const fixtureKey = "sk-fakellm02-ABCDEF0123456789";
const fixtureBearer = "synthetic-ABCDEF0123456789+/==";
const fixtureOpaque = "opaque-fixture-secret-12345";

describe("LLM02 audit and structured-log credential controls", () => {
  test("new audit records scrub keys, nested fields and event text without breaking the chain", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-audit-secret-"));
    const store = new Store(join(dir, "audit.db"));
    try {
      store.audit(`fixture ${fixtureKey}`, { nested: { apiKey: fixtureOpaque, message: `Bearer ${fixtureBearer}` }, list: [fixtureKey] });
      const row = store.recentAudit(1)[0]!;
      const serialized = JSON.stringify(row);
      for (const secret of [fixtureKey, fixtureBearer, fixtureOpaque, "ABCDEF0123456789"]) expect(serialized).not.toContain(secret);
      expect(store.verifyChain().valid).toBe(true);
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  test("structured logs redact nested values and event text", () => {
    const lines: string[] = [];
    setLogWriter(line => lines.push(line));
    try {
      structuredLog("info", `fixture ${fixtureKey}`, { nested: { password: fixtureOpaque, authorization: `Bearer ${fixtureBearer}` }, list: [fixtureKey] });
      expect(lines).toHaveLength(1);
      for (const secret of [fixtureKey, fixtureBearer, fixtureOpaque]) expect(lines[0]).not.toContain(secret);
    } finally { setLogWriter(line => process.stdout.write(line + "\n")); }
  });
  test("audit report masks credential-shaped project and event strings, retains verifiability", () => {
    const report = buildAuditReport({ project: `project ${fixtureKey}`, chainValid: true, entries: [{ event: `Bearer ${fixtureBearer}`, detail: fixtureOpaque, hash: "abcdef0123456789", created_at: 1_750_000_000_000 }] });
    for (const secret of [fixtureKey, fixtureBearer, fixtureOpaque]) expect(report.markdown).not.toContain(secret);
    expect(verifyAuditReport(report.markdown).valid).toBe(true);
  });
});

test("recursive redaction handles cycles while preserving ordinary token metrics", async () => {
  const { redactAttributes } = await import("../../src/observability/redaction.ts");
  const cyclic: Record<string, unknown> = { password: fixtureOpaque, tokenCount: 12 };
  cyclic.self = cyclic;
  const safe = redactAttributes({ nested: cyclic, apiKey: fixtureOpaque, token: 42 });
  const json = JSON.stringify(safe);
  expect(json).not.toContain(fixtureOpaque);
  expect(json).toContain("circular");
  expect(json).toContain('"tokenCount":12');
  expect(json).toContain('"token":42');
});


test("span names, event names and nested credential fields are redacted", async () => {
  const { startSpan } = await import("../../src/observability/tracer.ts");
  const span = startSpan(`operation ${fixtureKey}`);
  span.set("apiKey", fixtureOpaque);
  span.addEvent(`event ${fixtureKey}`, { nested: { authorization: `Bearer ${fixtureBearer}` } });
  span.setStatus("error", fixtureKey);
  const data = JSON.stringify(span.end());
  for (const secret of [fixtureKey, fixtureBearer, fixtureOpaque, "ABCDEF0123456789"]) expect(data).not.toContain(secret);
});


test("audit detail keeps JSON serialization semantics and legacy marker", async () => {
  const { redactAuditDetail } = await import("../../src/observability/redaction.ts");
  const safe = redactAuditDetail({ when: new Date("2026-01-02T03:04:05Z"), skip: undefined, nested: { apiKey: fixtureOpaque }, ordinary: 12 });
  expect(safe).toEqual({ when: "2026-01-02T03:04:05.000Z", nested: { apiKey: "«redacted»" }, ordinary: 12 });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  expect(() => redactAuditDetail(cycle)).toThrow();
});
