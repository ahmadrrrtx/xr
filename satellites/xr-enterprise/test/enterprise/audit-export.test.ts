/**
 * XR 6.1 — Phase 12 Tests: Audit redaction, export integrity, retention, legal hold.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  AuditExportService,
  RetentionService,
  redactRecord,
  redactRecords,
  proveRedactionFaithful,
  detectRedactionBypass,
  digestValue,
  verifyExportedChain,
  classifyAuditEvent,
  defaultSensitivity,
  adaptWorkspaceAuditRows,
  defaultRetentionSchedule,
  DEFAULT_REDACTION_RULES,
  type AuditRecord,
  type RedactionRule,
} from "../../src/enterprise/index.ts";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

/** Build a hash-chained set of records the way the workspace store does. */
function buildChain(count: number, overrides: Partial<AuditRecord>[] = []): AuditRecord[] {
  const records: AuditRecord[] = [];
  let prev = "0".repeat(64);
  for (let i = 0; i < count; i++) {
    const o = overrides[i] ?? {};
    const at = o.at ?? NOW - (count - i) * 1000;
    const event = o.event ?? `test.event.${i}`;
    const detail = o.detail ?? { index: i };
    const hash = createHash("sha256").update(`${prev}${event}${JSON.stringify(detail)}${at}`).digest("hex");
    records.push({
      recordId: `r${i}`,
      sequence: i + 1,
      eventClass: o.eventClass ?? "system",
      event,
      at,
      actorId: o.actorId ?? "user1",
      organizationId: o.organizationId,
      workspaceId: o.workspaceId,
      sensitivity: o.sensitivity ?? "internal",
      detail,
      prevHash: prev,
      hash,
      ...("sessionId" in o ? { sessionId: o.sessionId } : {}),
    });
    prev = hash;
  }
  return records;
}

describe("Audit event classification", () => {
  test("classifies known event families", () => {
    expect(classifyAuditEvent("enterprise.incident.declared")).toBe("incident");
    expect(classifyAuditEvent("enterprise.policy.bundle.activated")).toBe("policy");
    expect(classifyAuditEvent("enterprise.authority.delegation.created")).toBe("authority");
    expect(classifyAuditEvent("enterprise.supplychain.revoked")).toBe("supply_chain");
    expect(classifyAuditEvent("enterprise.recovery.restore")).toBe("recovery");
    expect(classifyAuditEvent("shield.threat.blocked")).toBe("security");
    expect(classifyAuditEvent("random.unknown.thing")).toBe("system");
  });

  test("security and incident events default to confidential", () => {
    expect(defaultSensitivity("security")).toBe("confidential");
    expect(defaultSensitivity("incident")).toBe("confidential");
    expect(defaultSensitivity("execution")).toBe("internal");
  });
});

describe("Redaction", () => {
  test("default rules always protect credential fields", () => {
    const rec = buildChain(1, [{ detail: { token: "sk-abcdef1234567890", note: "hello" } }])[0]!;
    const { record } = redactRecord(rec, { rules: [] });
    expect(JSON.stringify(record.detail)).not.toContain("sk-abcdef1234567890");
    expect(record.detail.note).toBe("hello");
    expect(record.redactedFields.some((f) => f.path === "token")).toBe(true);
  });

  test("remove deletes the field entirely", () => {
    const rec = buildChain(1, [{ detail: { password: "hunter2", keep: 1 } }])[0]!;
    const { record } = redactRecord(rec, { rules: [] });
    expect("password" in record.detail).toBe(false);
    expect(record.detail.keep).toBe(1);
  });

  test("mask preserves shape without content", () => {
    const rec = buildChain(1, [{ detail: { email: "alice@example.com" } }])[0]!;
    const rules: RedactionRule[] = [{ ruleId: "r1", path: "email", mode: "mask", reason: "PII" }];
    const { record } = redactRecord(rec, { rules });
    expect(String(record.detail.email)).not.toBe("alice@example.com");
    expect(String(record.detail.email)).toContain("*");
  });

  test("hash replaces with a stable digest prefix", () => {
    const rec = buildChain(1, [{ detail: { userId: "u-12345" } }])[0]!;
    const rules: RedactionRule[] = [{ ruleId: "r1", path: "userId", mode: "hash", reason: "pseudonymize" }];
    const { record } = redactRecord(rec, { rules });
    expect(String(record.detail.userId)).toStartWith("sha256:");
  });

  test("wildcard redacts every top-level field", () => {
    const rec = buildChain(1, [{ detail: { a: 1, b: 2, c: 3 } }])[0]!;
    const rules: RedactionRule[] = [{ ruleId: "all", path: "*", mode: "remove", reason: "full redaction" }];
    const { record } = redactRecord(rec, { rules });
    expect(Object.keys(record.detail).length).toBe(0);
    expect(record.redactedFields.length).toBe(3);
  });

  test("nested paths are supported", () => {
    const rec = buildChain(1, [{ detail: { user: { name: "Alice", ssn: "123-45-6789" } } }])[0]!;
    const rules: RedactionRule[] = [{ ruleId: "r1", path: "user.ssn", mode: "remove", reason: "PII" }];
    const { record } = redactRecord(rec, { rules });
    const user = record.detail.user as Record<string, unknown>;
    expect(user.name).toBe("Alice");
    expect("ssn" in user).toBe(false);
  });

  test("sensitivity threshold limits rule application", () => {
    const internal = buildChain(1, [{ detail: { field: "x" }, sensitivity: "internal" }])[0]!;
    const restricted = buildChain(1, [{ detail: { field: "x" }, sensitivity: "restricted" }])[0]!;
    const rules: RedactionRule[] = [
      { ruleId: "r1", path: "field", mode: "remove", reason: "only for restricted", appliesAtOrAbove: "restricted" },
    ];
    expect("field" in redactRecord(internal, { rules }).record.detail).toBe(true);
    expect("field" in redactRecord(restricted, { rules }).record.detail).toBe(false);
  });

  test("REDACTION PRESERVES THE HASH CHAIN", () => {
    const originals = buildChain(5, [
      {}, { detail: { token: "sk-secret-value-here" } }, {}, {}, {},
    ]);
    const { records } = redactRecords(originals, { rules: [] });

    // Hashes are untouched, so the chain still verifies.
    for (let i = 0; i < records.length; i++) {
      expect(records[i]!.hash).toBe(originals[i]!.hash);
      expect(records[i]!.prevHash).toBe(originals[i]!.prevHash);
      expect(records[i]!.originalHash).toBe(originals[i]!.hash);
    }
    expect(verifyExportedChain(records, { contiguous: true }).intact).toBe(true);
  });

  test("redaction is faithful and provable", () => {
    const originals = buildChain(3, [
      { detail: { token: "sk-aaa", note: "n1" } },
      { detail: { token: "sk-bbb", note: "n2" } },
      { detail: { note: "n3" } },
    ]);
    const { records } = redactRecords(originals, { rules: [] });
    const proof = proveRedactionFaithful(originals, records);
    expect(proof.ok).toBe(true);
    expect(proof.mismatches.length).toBe(0);
    expect(proof.checked).toBeGreaterThan(0);
  });

  test("a forged redaction digest is detected", () => {
    const originals = buildChain(1, [{ detail: { token: "sk-real" } }]);
    const { records } = redactRecords(originals, { rules: [] });
    const forged = [
      {
        ...records[0]!,
        redactedFields: records[0]!.redactedFields.map((f) => ({ ...f, originalDigest: digestValue("sk-fake") })),
      },
    ];
    const proof = proveRedactionFaithful(originals, forged);
    expect(proof.ok).toBe(false);
  });

  test("detectRedactionBypass finds leaked secrets", () => {
    const leaked = buildChain(1, [{ detail: { notes: "the key is sk-abcdefghijklmnop1234" } }]);
    const { records } = redactRecords(leaked, { rules: [] });
    // 'notes' is not a default-protected field, so the secret survives.
    expect(detectRedactionBypass(records).length).toBeGreaterThan(0);

    const rules: RedactionRule[] = [{ ruleId: "notes", path: "notes", mode: "remove", reason: "free text may contain secrets" }];
    const { records: clean } = redactRecords(leaked, { rules });
    expect(detectRedactionBypass(clean).length).toBe(0);
  });

  test("DEFAULT_REDACTION_RULES covers common credential names", () => {
    const paths = DEFAULT_REDACTION_RULES.map((r) => r.path);
    for (const p of ["token", "secret", "password", "apiKey", "authorization", "privateKey"]) {
      expect(paths).toContain(p);
    }
  });
});

describe("Audit export", () => {
  function service(records: AuditRecord[], authorizer?: ConstructorParameters<typeof AuditExportService>[0]["authorizer"]) {
    return new AuditExportService({ source: () => records, now: () => NOW, authorizer });
  }

  test("a complete export carries an integrity manifest", () => {
    const records = buildChain(10);
    const svc = service(records);
    const result = svc.export({
      requestedBy: "admin",
      format: "jsonl",
      redactionRules: [],
      reason: "quarterly review",
    });

    expect(result.manifest.status).toBe("complete");
    expect(result.manifest.recordCount).toBe(10);
    expect(result.manifest.contentHash.length).toBe(64);
    expect(result.manifest.chainVerified).toBe(true);
    expect(result.manifest.firstSequence).toBe(1);
    expect(result.manifest.lastSequence).toBe(10);
  });

  test("verify detects an altered payload", () => {
    const svc = service(buildChain(5));
    const result = svc.export({ requestedBy: "admin", format: "jsonl", redactionRules: [], reason: "r" });

    expect(svc.verify(result).ok).toBe(true);

    const tampered = { ...result, serialized: result.serialized + "\n{}" };
    const v = svc.verify(tampered);
    expect(v.ok).toBe(false);
    expect(v.contentHashMatches).toBe(false);
  });

  test("denied export produces a denied manifest and a logged denial", () => {
    const svc = service(buildChain(3), {
      canExport: () => ({ granted: false, reason: "Not an auditor." }),
    });
    const result = svc.export({ requestedBy: "intruder", format: "json", redactionRules: [], reason: "curious" });

    expect(result.manifest.status).toBe("denied");
    expect(result.records.length).toBe(0);
    expect(result.serialized).toBe("");
    expect(result.manifest.incompleteReason).toContain("Not an auditor");

    const denials = svc.accessEntries({ granted: false });
    expect(denials.length).toBe(1);
    expect(denials[0]!.actorId).toBe("intruder");
  });

  test("restricted records are withheld unless explicitly authorized", () => {
    const records = buildChain(4, [
      {}, { sensitivity: "restricted" }, {}, { sensitivity: "restricted" },
    ]);
    const svc = service(records);

    const withheld = svc.export({ requestedBy: "admin", format: "json", redactionRules: [], reason: "r" });
    expect(withheld.manifest.status).toBe("partial");
    expect(withheld.manifest.withheldCount).toBe(2);
    expect(withheld.manifest.recordCount).toBe(2);
    expect(withheld.manifest.incompleteReason).toContain("withheld");

    const full = svc.export({
      requestedBy: "admin",
      format: "json",
      redactionRules: [],
      reason: "legal",
      includeRestricted: true,
    });
    expect(full.manifest.recordCount).toBe(4);
    expect(full.manifest.withheldCount).toBe(0);
  });

  test("TRUNCATION IS NEVER SILENT", () => {
    const svc = service(buildChain(50));
    const result = svc.export({
      requestedBy: "admin",
      format: "jsonl",
      redactionRules: [],
      reason: "r",
      maxRecords: 10,
    });
    expect(result.manifest.status).toBe("partial");
    expect(result.manifest.recordCount).toBe(10);
    expect(result.manifest.incompleteReason).toContain("truncated");
  });

  test("organization scoping prevents cross-tenant export", () => {
    const records = [
      ...buildChain(3).map((r) => ({ ...r, organizationId: "org1" })),
      ...buildChain(3).map((r) => ({ ...r, organizationId: "org2", recordId: `o2_${r.recordId}` })),
    ];
    const svc = service(records);
    const result = svc.export({
      requestedBy: "admin1",
      organizationId: "org1",
      format: "json",
      redactionRules: [],
      reason: "r",
    });
    expect(result.records.length).toBe(3);
    expect(result.records.every((r) => r.organizationId === "org1")).toBe(true);
  });

  test("time window and event class filters apply", () => {
    const records = buildChain(6, [
      { eventClass: "security" }, { eventClass: "system" }, { eventClass: "security" },
      { eventClass: "policy" }, { eventClass: "security" }, { eventClass: "system" },
    ]);
    const svc = service(records);
    const result = svc.export({
      requestedBy: "admin",
      format: "json",
      redactionRules: [],
      reason: "r",
      eventClasses: ["security"],
    });
    expect(result.records.length).toBe(3);
    expect(result.records.every((r) => r.eventClass === "security")).toBe(true);
  });

  test("export applies redaction and reports the field count", () => {
    const records = buildChain(3, [
      { detail: { token: "sk-1" } }, { detail: { token: "sk-2" } }, { detail: { plain: "ok" } },
    ]);
    const svc = service(records);
    const result = svc.export({ requestedBy: "admin", format: "jsonl", redactionRules: [], reason: "r" });
    expect(result.manifest.redactedFieldCount).toBe(2);
    expect(result.serialized).not.toContain("sk-1");
    expect(result.manifest.appliedRedactionRuleIds.length).toBeGreaterThan(0);
  });

  test("csv format produces a header and one row per record", () => {
    const svc = service(buildChain(3));
    const result = svc.export({ requestedBy: "admin", format: "csv", redactionRules: [], reason: "r" });
    const lines = result.serialized.split("\n");
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain("recordId");
  });

  test("json and jsonl round-trip", () => {
    const svc = service(buildChain(3));
    const jsonl = svc.export({ requestedBy: "a", format: "jsonl", redactionRules: [], reason: "r" });
    expect(jsonl.serialized.split("\n").length).toBe(3);
    const json = svc.export({ requestedBy: "a", format: "json", redactionRules: [], reason: "r" });
    expect(Array.isArray(JSON.parse(json.serialized))).toBe(true);
  });

  test("a failing audit source produces a failed manifest, not a throw", () => {
    const svc = new AuditExportService({
      source: () => {
        throw new Error("database is locked");
      },
      now: () => NOW,
    });
    const result = svc.export({ requestedBy: "admin", format: "json", redactionRules: [], reason: "r" });
    expect(result.manifest.status).toBe("failed");
    expect(result.manifest.incompleteReason).toContain("database is locked");
  });

  test("every export attempt is access-logged", () => {
    const svc = service(buildChain(2));
    svc.export({ requestedBy: "auditor1", format: "json", redactionRules: [], reason: "r" });
    svc.export({ requestedBy: "auditor2", format: "json", redactionRules: [], reason: "r" });
    expect(svc.accessEntries().length).toBe(2);
    expect(svc.accessEntries({ actorId: "auditor1" }).length).toBe(1);
  });

  test("an empty export is complete, not failed", () => {
    const svc = service([]);
    const result = svc.export({ requestedBy: "admin", format: "json", redactionRules: [], reason: "r" });
    expect(result.manifest.status).toBe("complete");
    expect(result.manifest.recordCount).toBe(0);
  });

  test("a broken source chain is reported, not hidden", () => {
    const records = buildChain(4);
    const broken = [...records];
    broken[2] = { ...broken[2]!, prevHash: "0".repeat(64) };
    const check = verifyExportedChain(
      redactRecords(broken, { rules: [] }).records,
      { contiguous: true },
    );
    expect(check.intact).toBe(false);
    expect(check.breakAtSequence).toBe(3);
  });
});

describe("Workspace audit row adapter", () => {
  test("adapts raw rows and parses detail", () => {
    const rows = [
      { id: 1, session_id: "s1", event: "shield.blocked", detail: '{"actorId":"u1","x":2}', prev_hash: "0".repeat(64), hash: "a".repeat(64), created_at: NOW },
    ];
    const recs = adaptWorkspaceAuditRows(rows, { organizationId: "org1", workspaceId: "ws1" });
    expect(recs.length).toBe(1);
    expect(recs[0]!.eventClass).toBe("security");
    expect(recs[0]!.actorId).toBe("u1");
    expect(recs[0]!.organizationId).toBe("org1");
    expect(recs[0]!.sequence).toBe(1);
  });

  test("malformed detail does not throw", () => {
    const rows = [
      { id: 1, session_id: null, event: "x", detail: "not json", prev_hash: "0".repeat(64), hash: "b".repeat(64), created_at: NOW },
    ];
    const recs = adaptWorkspaceAuditRows(rows);
    expect(recs[0]!.detail.raw).toBe("not json");
  });
});

describe("Retention and legal hold", () => {
  test("default schedule covers every event class", () => {
    const s = defaultRetentionSchedule({ createdBy: "admin", now: NOW });
    expect(s.rules.length).toBe(10);
    expect(s.rules.find((r) => r.eventClass === "security")!.retainDays).toBe(730);
  });

  test("records within retention are retained", () => {
    const svc = new RetentionService({ now: () => NOW });
    svc.setSchedule(defaultRetentionSchedule({ createdBy: "admin", now: NOW }));
    const rec = buildChain(1, [{ eventClass: "execution", at: NOW - 10 * DAY }])[0]!;
    expect(svc.evaluate(rec).action).toBe("retain");
  });

  test("expired records are marked for deletion", () => {
    const svc = new RetentionService({ now: () => NOW });
    svc.setSchedule(defaultRetentionSchedule({ createdBy: "admin", now: NOW }));
    const rec = buildChain(1, [{ eventClass: "execution", at: NOW - 200 * DAY }])[0]!;
    expect(svc.evaluate(rec).action).toBe("delete");
  });

  test("records past the archive threshold are archived", () => {
    const svc = new RetentionService({ now: () => NOW });
    svc.setSchedule(defaultRetentionSchedule({ createdBy: "admin", now: NOW }));
    // execution retains 90d, archives after 45d.
    const rec = buildChain(1, [{ eventClass: "execution", at: NOW - 60 * DAY }])[0]!;
    expect(svc.evaluate(rec).action).toBe("archive");
  });

  test("A LEGAL HOLD BLOCKS DELETION AND REPORTS THE CONFLICT", () => {
    const svc = new RetentionService({ now: () => NOW });
    svc.setSchedule(defaultRetentionSchedule({ createdBy: "admin", now: NOW }));
    const hold = svc.placeHold({ reason: "Litigation XYZ", placedBy: "counsel" });

    const rec = buildChain(1, [{ eventClass: "execution", at: NOW - 200 * DAY }])[0]!;
    const ev = svc.evaluate(rec);

    expect(ev.action).toBe("hold_blocked");
    expect(ev.blockingHoldId).toBe(hold.holdId);
    expect(ev.reason).toContain("Litigation XYZ");
  });

  test("releasing a hold restores normal deletion", () => {
    const svc = new RetentionService({ now: () => NOW });
    svc.setSchedule(defaultRetentionSchedule({ createdBy: "admin", now: NOW }));
    const hold = svc.placeHold({ reason: "case", placedBy: "counsel" });
    const rec = buildChain(1, [{ eventClass: "execution", at: NOW - 200 * DAY }])[0]!;

    expect(svc.evaluate(rec).action).toBe("hold_blocked");
    expect(svc.releaseHold(hold.holdId, "counsel").ok).toBe(true);
    expect(svc.evaluate(rec).action).toBe("delete");
  });

  test("a scoped hold only covers its scope", () => {
    const svc = new RetentionService({ now: () => NOW });
    svc.setSchedule(defaultRetentionSchedule({ createdBy: "admin", now: NOW }));
    svc.placeHold({ reason: "org1 only", placedBy: "counsel", organizationId: "org1" });

    const inScope = { ...buildChain(1, [{ eventClass: "execution", at: NOW - 200 * DAY }])[0]!, organizationId: "org1" };
    const outScope = { ...buildChain(1, [{ eventClass: "execution", at: NOW - 200 * DAY }])[0]!, organizationId: "org2" };

    expect(svc.evaluate(inScope).action).toBe("hold_blocked");
    expect(svc.evaluate(outScope).action).toBe("delete");
  });

  test("an event-class hold only covers those classes", () => {
    const svc = new RetentionService({ now: () => NOW });
    svc.setSchedule(defaultRetentionSchedule({ createdBy: "admin", now: NOW }));
    svc.placeHold({ reason: "security only", placedBy: "counsel", eventClasses: ["security"] });

    const sec = buildChain(1, [{ eventClass: "security", at: NOW - 800 * DAY }])[0]!;
    const exec = buildChain(1, [{ eventClass: "execution", at: NOW - 200 * DAY }])[0]!;

    expect(svc.evaluate(sec).action).toBe("hold_blocked");
    expect(svc.evaluate(exec).action).toBe("delete");
  });

  test("dry run never deletes", () => {
    const deleted: string[] = [];
    const svc = new RetentionService({ now: () => NOW, deleteRecords: (ids) => deleted.push(...ids) });
    svc.setSchedule(defaultRetentionSchedule({ createdBy: "admin", now: NOW }));
    const records = buildChain(3, [
      { eventClass: "execution", at: NOW - 200 * DAY },
      { eventClass: "execution", at: NOW - 200 * DAY },
      { eventClass: "execution", at: NOW - 1 * DAY },
    ]);

    const dry = svc.run(records, { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.deleted).toBe(0);
    expect(deleted.length).toBe(0);
    expect(dry.evaluated).toBe(3);
  });

  test("a live run deletes via the injected handler", () => {
    const deleted: string[] = [];
    const svc = new RetentionService({ now: () => NOW, deleteRecords: (ids) => deleted.push(...ids) });
    svc.setSchedule(defaultRetentionSchedule({ createdBy: "admin", now: NOW }));
    const records = buildChain(2, [
      { eventClass: "execution", at: NOW - 200 * DAY },
      { eventClass: "execution", at: NOW - 1 * DAY },
    ]);

    const live = svc.run(records, { dryRun: false, actorId: "admin" });
    expect(live.deleted).toBe(1);
    expect(deleted.length).toBe(1);
    expect(live.retained).toBe(1);
  });

  test("run reports hold conflicts", () => {
    const svc = new RetentionService({ now: () => NOW });
    svc.setSchedule(defaultRetentionSchedule({ createdBy: "admin", now: NOW }));
    svc.placeHold({ reason: "case", placedBy: "counsel" });
    const records = buildChain(2, [
      { eventClass: "execution", at: NOW - 200 * DAY },
      { eventClass: "execution", at: NOW - 200 * DAY },
    ]);
    const run = svc.run(records, { dryRun: true });
    expect(run.holdBlocked).toBe(2);
    expect(run.conflicts.length).toBe(2);
  });

  test("no schedule means retain by default", () => {
    const svc = new RetentionService({ now: () => NOW });
    const rec = buildChain(1, [{ at: NOW - 10_000 * DAY }])[0]!;
    expect(svc.evaluate(rec).action).toBe("retain");
  });

  test("setting a schedule bumps its version", () => {
    const svc = new RetentionService({ now: () => NOW });
    const s1 = svc.setSchedule(defaultRetentionSchedule({ createdBy: "admin", now: NOW }));
    expect(s1.version).toBe(1);
    const s2 = svc.setSchedule(defaultRetentionSchedule({ createdBy: "admin", now: NOW }));
    expect(s2.version).toBe(2);
  });
});
