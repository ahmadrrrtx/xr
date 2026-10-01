/**
 * Phase 7 · approval primitives (desktop/src/lib/approvalCore.ts).
 *
 * Pure logic only — the queue's IPC/modal sides are covered by the
 * Playwright pass; Rust-side rule persistence by commands/approvals.rs.
 * Negative branches included per house rule.
 */
import { describe, expect, test } from "bun:test";

// Relative import — same convention as the other desktop tests (no path alias).
import * as core from "../../desktop/src/lib/approvalCore.ts";

const {
  APPROVAL_RISKS,
  AUTO_DENY_MS_DEFAULT,
  BELL_VISIBLE,
  NOTIFICATION_CAP,
  RISK_COPY,
  RULE_1H_MS,
  capNotifications,
  checkRules,
  dayLabel,
  isApprovalRisk,
  isNotificationType,
  isRememberKey,
  isRuleDuration,
  isRuleEffect,
  nextActiveId,
  parseAutoDenyMs,
  persistableRules,
  pruneRules,
  relativeTime,
  remember1hLabel,
  rememberAlwaysLabel,
  ruleFromDecision,
  ruleMatches,
} = core;

const REQ = (over: Partial<core.ApprovalRequest> = {}): core.ApprovalRequest => ({
  id: "req-1",
  skillId: "gmail-skill",
  skillName: "gmail-skill",
  skillVersion: "v1.2",
  skillIcon: "mail",
  action: "Send email",
  resource: "sarah@company.com",
  risk: "medium",
  justification: "test",
  createdAt: 1_000,
  ...over,
});

const RULE = (over: Partial<core.ApprovalRule> = {}): core.ApprovalRule => ({
  id: "rule-1",
  skillId: "gmail-skill",
  action: "Send email",
  resource: "sarah@company.com",
  effect: "allow",
  duration: "forever",
  createdAt: 500,
  ...over,
});

describe("Phase 7 · guards", () => {
  test("risks, remember keys, durations, effects, notification types validate", () => {
    for (const r of ["low", "medium", "high"] as const) expect(isApprovalRisk(r)).toBe(true);
    expect(APPROVAL_RISKS).toHaveLength(3);
    expect(isApprovalRisk("extreme")).toBe(false);
    expect(isApprovalRisk(3)).toBe(false);

    expect(isRememberKey("always")).toBe(true);
    expect(isRememberKey("1h")).toBe(true);
    expect(isRememberKey("once")).toBe(false); // "once" = absence, not a key

    for (const d of ["forever", "1h", "session"] as const) expect(isRuleDuration(d)).toBe(true);
    expect(isRuleDuration("sometimes")).toBe(false);
    expect(isRuleEffect("allow")).toBe(true);
    expect(isRuleEffect("deny")).toBe(true);
    expect(isRuleEffect("maybe")).toBe(false);

    expect(isNotificationType("approval-request")).toBe(true);
    expect(isNotificationType("info")).toBe(true);
    expect(isNotificationType("gossip")).toBe(false);
  });
});

describe("Phase 7 · rule matching", () => {
  test("exact skill+action+resource matches", () => {
    expect(ruleMatches(RULE(), REQ(), 2_000)).toBe(true);
  });

  test("different skill, action or resource never matches", () => {
    expect(ruleMatches(RULE({ skillId: "other" }), REQ(), 2_000)).toBe(false);
    expect(ruleMatches(RULE({ action: "Read email" }), REQ(), 2_000)).toBe(false);
    expect(ruleMatches(RULE({ resource: null }), REQ(), 2_000)).toBe(false);
    expect(ruleMatches(RULE(), REQ({ resource: null }), 2_000)).toBe(false);
  });

  test("1h rules expire; forever and session never do", () => {
    const at = RULE_1H_MS - 10;
    expect(ruleMatches(RULE({ duration: "1h", createdAt: 0 }), REQ(), at)).toBe(true);
    expect(ruleMatches(RULE({ duration: "1h", createdAt: 0 }), REQ(), RULE_1H_MS + 1)).toBe(false);
    expect(ruleMatches(RULE({ duration: "forever" }), REQ(), 9_999_999)).toBe(true);
    expect(ruleMatches(RULE({ duration: "session" }), REQ(), 9_999_999)).toBe(true);
  });

  test("pruneRules drops only expired 1h rules", () => {
    const rules = [
      RULE({ id: "a", duration: "1h", createdAt: 0 }),
      RULE({ id: "b", duration: "forever" }),
      RULE({ id: "c", duration: "session" }),
    ];
    const kept = pruneRules(rules, RULE_1H_MS + 1);
    expect(kept.map((r) => r.id)).toEqual(["b", "c"]);
  });

  test("checkRules decides allow / deny / ask, and prunes", () => {
    // expired = its hour elapsed long before `now` (createdAt far in the past)
    const expired = RULE({ id: "old", duration: "1h", createdAt: -RULE_1H_MS - 100 });
    const active = RULE({ id: "now" });
    const { decision, rules } = checkRules([expired, active], REQ(), 5_000);
    expect(rules.map((r) => r.id)).toEqual(["now"]); // expired pruned away
    expect(decision).toEqual({ status: "approved", auto: true, ruleId: "now" });

    const deny = checkRules([RULE({ effect: "deny" })], REQ(), 5_000);
    expect(deny.decision?.status).toBe("denied");
    expect(deny.decision?.auto).toBe(true);

    const ask = checkRules(
      [RULE({ skillId: "unrelated" })],
      REQ(),
      5_000
    );
    expect(ask.decision).toBeNull();
  });
});

describe("Phase 7 · remember rules", () => {
  test("always → forever, 1h → 1h, allow-effect, request-shaped", () => {
    const always = ruleFromDecision(REQ(), "always", 7_000);
    expect(always.duration).toBe("forever");
    expect(always.effect).toBe("allow");
    expect(always.resource).toBe("sarah@company.com");
    const hour = ruleFromDecision(REQ(), "1h", 7_000);
    expect(hour.duration).toBe("1h");
    expect(hour.createdAt).toBe(7_000);
  });

  test("persistableRules drops session rules", () => {
    const out = persistableRules([
      RULE({ id: "a" }),
      RULE({ id: "b", duration: "session" }),
    ]);
    expect(out.map((r) => r.id)).toEqual(["a"]);
  });

  test("labels: resource-specific vs generic", () => {
    expect(rememberAlwaysLabel(REQ())).toBe(
      "Always allow gmail-skill to send email to sarah@company.com"
    );
    expect(rememberAlwaysLabel(REQ({ resource: null }))).toBe(
      "Always allow gmail-skill to send email"
    );
    expect(remember1hLabel(REQ())).toContain("for 1 hour");
  });
});

describe("Phase 7 · queue advance", () => {
  test("next modal = oldest remaining after a decision", () => {
    const pending = [REQ({ id: "a" }), REQ({ id: "b" }), REQ({ id: "c" })];
    expect(nextActiveId(pending, "a")).toBe("b");
    expect(nextActiveId(pending, "b")).toBe("a"); // a is still oldest
    expect(nextActiveId([REQ({ id: "solo" })], "solo")).toBeNull();
  });
});

describe("Phase 7 · auto-deny dev override", () => {
  test("default 60s; override honored; garbage falls back", () => {
    expect(parseAutoDenyMs(null)).toBe(AUTO_DENY_MS_DEFAULT);
    expect(parseAutoDenyMs("3000")).toBe(3000);
    expect(parseAutoDenyMs("-5")).toBe(AUTO_DENY_MS_DEFAULT);
    expect(parseAutoDenyMs("banana")).toBe(AUTO_DENY_MS_DEFAULT);
    expect(parseAutoDenyMs("999999999")).toBe(AUTO_DENY_MS_DEFAULT); // capped
  });
});

describe("Phase 7 · notifications", () => {
  const N = (id: string, createdAt = 1_000): core.Notification => ({
    id,
    type: "info",
    title: `n-${id}`,
    createdAt,
    read: false,
  });

  test("cap keeps newest first, cap respected", () => {
    const many = Array.from({ length: NOTIFICATION_CAP + 20 }, (_, i) =>
      N(`n${i}`, i)
    );
    const capped = capNotifications(many);
    expect(capped).toHaveLength(NOTIFICATION_CAP);
    expect(capped[0]?.id).toBe("n0");
    expect(BELL_VISIBLE).toBeLessThanOrEqual(NOTIFICATION_CAP);
  });

  test("relative time buckets", () => {
    const now = 100_000;
    expect(relativeTime(now - 10_000, now)).toBe("Just now");
    expect(relativeTime(now - 44_000, now)).toBe("Just now");
    expect(relativeTime(now - 120_000, now)).toBe("2m ago");
    expect(relativeTime(now - 3 * 60 * 60 * 1000, now)).toBe("3h ago");
    expect(relativeTime(now - 26 * 60 * 60 * 1000, now)).toBe("1d ago");
  });

  test("day labels", () => {
    const now = new Date(2026, 9, 1, 15, 0).getTime();
    const sameDay = new Date(2026, 9, 1, 1, 0).getTime();
    const yesterday = new Date(2026, 8, 30, 23, 0).getTime();
    const older = new Date(2026, 7, 12, 9, 0).getTime();
    expect(dayLabel(now, now)).toBe("Today");
    expect(dayLabel(sameDay, now)).toBe("Today");
    expect(dayLabel(yesterday, now)).toBe("Yesterday");
    // Anything further back gets a date label, never Today/Yesterday
    expect(dayLabel(older, now)).not.toBe("Today");
    expect(dayLabel(older, now)).not.toBe("Yesterday");
  });

  test("risk copy is human, one line each", () => {
    for (const risk of APPROVAL_RISKS) {
      expect(RISK_COPY[risk].label).toMatch(/risk$/);
      expect(RISK_COPY[risk].explanation.length).toBeGreaterThan(10);
    }
  });
});
