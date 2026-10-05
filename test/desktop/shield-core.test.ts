/**
 * Phase 12 · Shield pure logic (desktop/src/shield/{core,hash,seed}.ts).
 *
 * The hash chain, the policy gate, state derivation, filters, export, PII
 * masking and domain validation are pure; the store, the screen and the
 * Rust commands are covered by the Playwright pass + cargo tests. Negative
 * branches included per house rule: a chain verifier that cannot fail
 * proves nothing.
 */
import { describe, expect, test } from "bun:test";

import * as core from "../../desktop/src/shield/core.ts";
import { sha256Hex, sha256HexSync } from "../../desktop/src/shield/hash.ts";
import { buildSeedChain, seedAuditInputs, seedQuarantine, SEED_COUNT } from "../../desktop/src/shield/seed.ts";
import { DEFAULT_POLICY, type AuditEntry, type HealthCheck } from "../../desktop/src/shield/types.ts";
import type { ApprovalRequest } from "../../desktop/src/lib/approvalCore.ts";

const NOW = new Date(2026, 9, 5, 12, 0, 0).getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function check(id: HealthCheck["id"], status: HealthCheck["status"], critical = true): HealthCheck {
  return { id, label: id, status, detail: "", critical };
}

function req(over: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "apr-1",
    skillId: "fs-skill",
    skillName: "fs-skill",
    skillVersion: "v1.0",
    skillIcon: "file",
    action: "Write a file",
    resource: "~/notes/standup.md",
    risk: "medium",
    justification: "test",
    createdAt: NOW,
    ...over,
  };
}

describe("sha256", () => {
  test("pure-JS and WebCrypto paths agree with the FIPS vector", async () => {
    const abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(sha256HexSync("abc")).toBe(abc);
    expect(await sha256Hex("abc")).toBe(abc);
    expect(sha256HexSync("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    // Multi-block + non-ASCII (two 64-byte blocks, UTF-8 bytes).
    const long = "x".repeat(100) + "é";
    expect(sha256HexSync(long)).toBe(await sha256Hex(long));
  });
});

describe("audit chain", () => {
  test("seed chains, verifies, and is deterministic", async () => {
    const a = await buildSeedChain(NOW, sha256Hex);
    const b = await buildSeedChain(NOW, sha256Hex);
    expect(a.length).toBe(SEED_COUNT + 4);
    expect(a.map((e) => e.hash)).toEqual(b.map((e) => e.hash));
    expect(a[0].prevHash).toBeNull();
    expect(a[1].prevHash).toBe(a[0].hash);
    expect(a.every((e) => e.signature === null)).toBe(true);
    expect(a.every((e) => e.ts <= NOW && e.ts >= NOW - 30 * DAY)).toBe(true);
    const v = await core.verifyChain(a, sha256Hex, NOW);
    expect(v.valid).toBe(true);
    expect(v.checked).toBe(a.length);
    expect(v.detail).toContain("Ed25519 signatures planned");
  });

  test("tampering a field or a link is detected", async () => {
    const chain = await buildSeedChain(NOW, sha256Hex, 20);
    const tampered: AuditEntry[] = chain.map((e, i) =>
      i === 7 ? { ...e, decision: "allowed", action: "Delete a folder" } : e,
    );
    const v = await core.verifyChain(tampered, sha256Hex, NOW);
    expect(v.valid).toBe(false);
    expect(v.brokenAt).toBe(7);

    const cut: AuditEntry[] = [...chain.slice(0, 5), ...chain.slice(6)];
    const v2 = await core.verifyChain(cut, sha256Hex, NOW);
    expect(v2.valid).toBe(false);
    expect(v2.brokenAt).toBe(5);
  });

  test("empty chain is trivially valid; canonical form is stable", async () => {
    const v = await core.verifyChain([], sha256Hex, NOW);
    expect(v.valid).toBe(true);
    expect(v.checked).toBe(0);
    const s = core.canonicalAuditString({
      id: "aud_000001", ts: 1, actor: "user", skill: null, action: "Send email", resource: "a@b.co",
      decision: "allowed", ruleId: null, risk: "medium", costUsd: 0.1, prevHash: null, detail: null,
    });
    expect(s).toBe('["aud_000001","1","user","","Send email","a@b.co","allowed","","medium","0.100000","",""]');
    expect(core.canonicalCost(null)).toBe("");
    expect(core.canonicalCost(0)).toBe("0.000000");
  });
});

describe("state derivation", () => {
  test("no checks → unknown (never green before a check ran)", () => {
    expect(core.deriveState([])).toBe("unknown");
    expect(core.headlineFor("unknown")).toBe("XR Shield: CHECKING");
  });
  test("critical fail → compromised; warn → attention; planned never moves it", () => {
    expect(core.deriveState([check("audit_chain", "fail")])).toBe("compromised");
    expect(core.deriveState([check("audit_db", "pass"), check("approval_queue", "warn")])).toBe("attention");
    expect(core.deriveState([check("audit_db", "pass"), check("egress_proxy", "planned", false)])).toBe("protected");
    // Non-critical fail is attention, not compromised.
    expect(core.deriveState([check("version_integrity", "fail", false)])).toBe("attention");
  });
  test("checks sort fail → warn → pass → planned, stable within a group", () => {
    const sorted = core.sortChecks([
      check("audit_db", "pass"), check("egress_proxy", "planned", false), check("keychain", "warn"),
      check("settings_store", "pass"), check("audit_chain", "fail"),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["audit_chain", "keychain", "audit_db", "settings_store", "egress_proxy"]);
    expect(core.issueCount(sorted)).toBe(2);
    expect(core.ctaFor("attention", 2)).toBe("Review 2 issues");
    expect(core.ctaFor("attention", 1)).toBe("Review 1 issue");
    expect(core.ctaFor("protected", 0)).toBe("✓ All clear");
    expect(core.ctaFor("compromised", 3)).toBe("Resolve now");
  });
});

describe("gate", () => {
  const ctx = { paused: false, policy: DEFAULT_POLICY, quarantine: seedQuarantine(NOW) };

  test("paused blocks everything first", () => {
    const out = core.gateRequest(req({ risk: "low" }), { ...ctx, paused: true });
    expect(out).toMatchObject({ kind: "decide", decision: "blocked", ruleId: "policy.paused" });
  });
  test("shell is blocked while allowShellExec is off, prompts when on", () => {
    const shell = req({ skillId: "shell-skill", skillIcon: "terminal", action: "Run a shell command", risk: "high" });
    expect(core.gateRequest(shell, ctx)).toMatchObject({ kind: "decide", decision: "blocked", ruleId: "policy.shell-exec" });
    expect(core.gateRequest(shell, { ...ctx, policy: { ...DEFAULT_POLICY, allowShellExec: true } })).toEqual({ kind: "prompt", quarantined: false });
    expect(core.isShellRequest({ skillId: "x", skillIcon: "mail", action: "Open terminal session" })).toBe(true);
    expect(core.isShellRequest({ skillId: "x", skillIcon: "mail", action: "Send email" })).toBe(false);
  });
  test("low risk auto-approves only while the policy is on", () => {
    const low = req({ action: "Read a file", risk: "low" });
    expect(core.gateRequest(low, ctx)).toMatchObject({ kind: "decide", status: "approved", decision: "auto-approved", ruleId: "policy.auto-approve-low" });
    expect(core.gateRequest(low, { ...ctx, policy: { ...DEFAULT_POLICY, autoApproveLowRisk: false } })).toEqual({ kind: "prompt", quarantined: false });
  });
  test("quarantined skills always prompt; removed ones are blocked", () => {
    const q = req({ skillId: "figma-plugin", risk: "low" });
    expect(core.gateRequest(q, ctx)).toEqual({ kind: "prompt", quarantined: true });
    const removed = seedQuarantine(NOW).map((s) => (s.id === "figma-plugin" ? { ...s, status: "removed" as const } : s));
    expect(core.gateRequest(q, { ...ctx, quarantine: removed })).toMatchObject({ kind: "decide", decision: "blocked", ruleId: "policy.quarantine.removed" });
    // Quarantine policy off → trusted path (low risk auto-approves).
    expect(core.gateRequest(q, { ...ctx, policy: { ...DEFAULT_POLICY, quarantineNewSkills: false } })).toMatchObject({ decision: "auto-approved" });
  });
  test("medium/high risk prompts", () => {
    expect(core.gateRequest(req(), ctx)).toEqual({ kind: "prompt", quarantined: false });
  });
});

describe("audit filters, sort, stats", () => {
  const entries = seedAuditInputs(NOW).map((e, i) => ({ ...e, prevHash: null, hash: String(i), signature: null }) as AuditEntry);

  test("range + decision + actor + search filters", () => {
    const all = core.filterAudit(entries, { search: "", decision: "all", actor: "all", range: "all" }, NOW);
    expect(all.length).toBe(entries.length);
    const day = core.filterAudit(entries, { search: "", decision: "all", actor: "all", range: "24h" }, NOW);
    expect(day.every((e) => e.ts >= NOW - DAY)).toBe(true);
    expect(day.length).toBeGreaterThan(0);
    expect(day.length).toBeLessThan(all.length);
    const blocked = core.filterAudit(entries, { search: "", decision: "blocked", actor: "all", range: "all" }, NOW);
    expect(blocked.every((e) => e.decision === "blocked")).toBe(true);
    const users = core.filterAudit(entries, { search: "", decision: "all", actor: "user", range: "all" }, NOW);
    expect(users.every((e) => e.actor === "user")).toBe(true);
    const agents = core.filterAudit(entries, { search: "", decision: "all", actor: "agent", range: "all" }, NOW);
    expect(agents.every((e) => e.actor.startsWith("agent:"))).toBe(true);
    const search = core.filterAudit(entries, { search: "RUSQLITE", decision: "all", actor: "all", range: "all" }, NOW);
    expect(search.length).toBeGreaterThan(0);
    expect(search.every((e) => (e.resource ?? "").toLowerCase().includes("rusqlite"))).toBe(true);
    expect(core.filterAudit(entries, { search: "zzz-nothing", decision: "all", actor: "all", range: "all" }, NOW)).toEqual([]);
  });

  test("sort by time and cost, toggling direction", () => {
    const desc = core.sortAudit(entries, { col: "ts", dir: "desc" });
    expect(desc[0].ts).toBeGreaterThanOrEqual(desc[desc.length - 1].ts);
    const cost = core.sortAudit(entries, { col: "costUsd", dir: "desc" });
    expect(cost[0].costUsd).not.toBeNull();
    expect(core.nextAuditSort({ col: "ts", dir: "desc" }, "ts")).toEqual({ col: "ts", dir: "asc" });
    expect(core.nextAuditSort({ col: "ts", dir: "desc" }, "costUsd")).toEqual({ col: "costUsd", dir: "desc" });
  });

  test("stats count what did not run and the auto-approved share", () => {
    const s = core.computeStats(entries, 2, 3, NOW);
    expect(s.pendingApprovals).toBe(2);
    expect(s.quarantinedSkills).toBe(3);
    expect(s.blocked24h).toBe(entries.filter((e) => e.ts >= NOW - DAY && core.NOT_RUN.has(e.decision)).length);
    expect(s.autoApprovedRate30d).not.toBeNull();
    expect(s.autoApprovedRate30d!).toBeGreaterThan(0);
    expect(s.autoApprovedRate30d!).toBeLessThan(100);
    expect(core.computeStats([], 0, 0, NOW).autoApprovedRate30d).toBeNull();
    expect(core.recentActivity(entries, 10).length).toBe(10);
  });

  test("actor helpers", () => {
    expect(core.actorKind("user")).toBe("user");
    expect(core.actorKind("system")).toBe("system");
    expect(core.actorKind("agent:coder")).toBe("agent");
    expect(core.actorLabel("agent:coder")).toBe("coder");
    expect(core.actorLabel("user")).toBe("user");
  });
});

describe("export", () => {
  test("CSV escapes quotes/commas/newlines and neutralises formulas", () => {
    const e: AuditEntry = {
      id: "aud_1", ts: NOW, actor: "user", skill: "fs-skill", action: 'Write "notes", v2', resource: "=cmd|' /C calc'!A0",
      decision: "allowed", ruleId: null, risk: "medium", costUsd: 0.5, signature: null, prevHash: null, hash: "h", detail: "line1\nline2",
    };
    const csv = core.auditToCsv([e]);
    const nl = csv.indexOf("\n");
    const header = csv.slice(0, nl);
    const row = csv.slice(nl + 1);
    expect(header).toBe(core.AUDIT_CSV_COLUMNS.join(","));
    expect(row).toContain('"Write ""notes"", v2"');
    expect(row).toContain(",'=cmd|' /C calc'!A0,"); // leading quote defuses the formula
    expect(row).toContain('"line1\nline2"');
    expect(row.endsWith("\n")).toBe(true);
  });
  test("JSON export is honest about integrity", () => {
    const json = JSON.parse(core.auditToJson([], NOW));
    expect(json.integrity).toBe("sha256-hash-chain");
    expect(json.signatures).toContain("planned");
    expect(json.count).toBe(0);
  });
  test("filename follows the Phase 11 convention", () => {
    expect(core.exportFilename("csv", new Date(2026, 9, 5, 9, 7))).toBe("xr-shield-audit-2026-10-05-0907.csv");
  });
});

describe("PII redaction", () => {
  test("masks emails, cards, phones and key-shaped tokens; idempotent", () => {
    const text = "Send to sarah@company.com, card 4242 4242 4242 4242, call +1 (415) 555-0199, key sk-abcdefghijklmnop";
    const once = core.redactPii(text);
    expect(once).toContain("s•••@company.com");
    expect(once).toContain("•••• 4242");
    expect(once).toContain("••• ••• 0199");
    expect(once).toContain("sk-••••");
    expect(once).not.toContain("sarah@");
    expect(core.redactPii(once)).toBe(once);
    expect(core.redactPii("~/notes/standup.md")).toBe("~/notes/standup.md");
    expect(core.redactIfEnabled("a@b.co", false)).toBe("a@b.co");
    expect(core.redactIfEnabled(null, true)).toBeNull();
  });
});

describe("domain lists", () => {
  test("hostname validation and normalisation", () => {
    expect(core.isValidHostname("api.openai.com")).toBe(true);
    expect(core.isValidHostname("*.github.com")).toBe(true);
    expect(core.isValidHostname("Example.ORG")).toBe(true);
    expect(core.isValidHostname("https://x.com")).toBe(false);
    expect(core.isValidHostname("localhost")).toBe(false);
    expect(core.isValidHostname("x.com:443")).toBe(false);
    expect(core.isValidHostname("-bad.com")).toBe(false);
    expect(core.normalizeDomains([" API.openai.com ", "api.openai.com", "nope", "", "*.github.com"])).toEqual(["api.openai.com", "*.github.com"]);
  });
  test("policy patch normalises lists and keeps biometric off when unsupported", () => {
    const next = core.policyPatch(DEFAULT_POLICY, { biometricApproval: true, allowedDomains: ["A.com", "a.com"] });
    expect(next.biometricApproval).toBe(false);
    expect(next.allowedDomains).toEqual(["a.com"]);
    const supported = core.policyPatch({ ...DEFAULT_POLICY, biometricSupported: true }, { biometricApproval: true });
    expect(supported.biometricApproval).toBe(true);
  });
});

describe("formatting + keyboard", () => {
  test("cost / percent / ago", () => {
    expect(core.fmtCost(null)).toBe("—");
    expect(core.fmtCost(0)).toBe("$0");
    expect(core.fmtCost(0.0042)).toBe("$0.0042");
    expect(core.fmtCost(1.5)).toBe("$1.50");
    expect(core.fmtPercent(98.24)).toBe("98.2%");
    expect(core.fmtPercent(null)).toBe("—");
    expect(core.fmtAgo(NOW - 10_000, NOW)).toBe("just now");
    expect(core.fmtAgo(NOW - 3 * 60_000, NOW)).toBe("3 min ago");
    expect(core.fmtAgo(NOW - 5 * HOUR, NOW)).toBe("5 h ago");
    expect(core.fmtAgo(NOW - 3 * DAY, NOW)).toBe("3 d ago");
  });
  test("1–4 map to the tabs", () => {
    expect(core.tabForKey("1")).toBe("status");
    expect(core.tabForKey("2")).toBe("approvals");
    expect(core.tabForKey("3")).toBe("audit");
    expect(core.tabForKey("4")).toBe("security");
    expect(core.tabForKey("5")).toBeNull();
  });
});
