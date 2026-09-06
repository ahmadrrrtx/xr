/**
 * XR Phase 8 · Step 6 — headless Tier-2 second factor.
 *
 * The property: on a surface with no interactive human, approving a Tier-2
 * action requires typing back a phrase bound to that specific request. A
 * client that never read the request cannot approve it.
 *
 * The negative controls matter as much as the happy path — a second factor
 * that can be skipped, replayed across requests, or guessed from the tool name
 * is decoration. Each of those is tested to FAIL here.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import {
  ApprovalStore,
  typedConfirmPhrase,
  typedConfirmHash,
  requiresTypedConfirm,
} from "../../src/control/approval-store.ts";

let tmp: string;
let store: Store;
let approvals: ApprovalStore;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-tc-"));
  process.env.XR_HOME = join(tmp, "home");
  store = new Store(join(tmp, "s.db"));
  approvals = new ApprovalStore(store, { defaultTtlMs: 60_000 });
});

afterEach(() => {
  try {
    store.close();
  } catch {
    /* already closed */
  }
});

/** Read the audit trail through the store's public reader. */
const auditEvents = (): Array<{ event: string; data: any }> =>
  store.recentAudit(200).map((r) => ({ event: r.event, data: JSON.parse(r.detail ?? "{}") }));

describe("Phase 8 · Step 6 — which requests need a second factor", () => {
  test("tier2 and blocked require it; lower tiers do not", () => {
    expect(requiresTypedConfirm("tier2")).toBe(true);
    expect(requiresTypedConfirm("blocked")).toBe(true);
    expect(requiresTypedConfirm("tier1")).toBe(false);
    expect(requiresTypedConfirm("tier0")).toBe(false);
    expect(requiresTypedConfirm(undefined)).toBe(false);
  });

  test("the phrase is bound to the approval id, tool and args", () => {
    const a = typedConfirmPhrase({ id: "ap_1", tool: "delete_file", argsHash: "sha256:aaaaaaaa" });
    const b = typedConfirmPhrase({ id: "ap_2", tool: "delete_file", argsHash: "sha256:aaaaaaaa" });
    const c = typedConfirmPhrase({ id: "ap_1", tool: "shell", argsHash: "sha256:aaaaaaaa" });
    const d = typedConfirmPhrase({ id: "ap_1", tool: "delete_file", argsHash: "sha256:bbbbbbbb" });
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  test("the phrase is typable (lowercase words, no exotic characters)", () => {
    const p = typedConfirmPhrase({ id: "ap_1", tool: "delete_file", argsHash: "sha256:aaaaaaaa" });
    expect(p).toMatch(/^[a-z0-9_ ]+$/);
  });

  test("the hash is salted by approval id (same phrase, different request)", () => {
    expect(typedConfirmHash("ap_1", "x")).not.toBe(typedConfirmHash("ap_2", "x"));
  });
});

describe("Phase 8 · Step 6 — headless Tier-2 enforcement", () => {
  test("an interactive surface gets NO challenge (a human is already present)", () => {
    const h = approvals.request({ tool: "delete_file", reason: "r", riskTier: "tier2", surface: "cli", headless: false });
    expect(approvals.needsTypedConfirm(h.id)).toBe(false);
    expect(approvals.decide(h.id, true, { channel: "cli" })).toBe(true);
  });

  test("a headless tier-1 request needs no challenge", () => {
    const h = approvals.request({ tool: "read_file", reason: "r", riskTier: "tier1", surface: "daemon", headless: true });
    expect(approvals.needsTypedConfirm(h.id)).toBe(false);
    expect(approvals.decide(h.id, true, { channel: "daemon" })).toBe(true);
  });

  test("a headless tier-2 approval WITHOUT the phrase is refused and stays pending", async () => {
    const h = approvals.request({ tool: "delete_file", reason: "r", args: { path: "/x" }, riskTier: "tier2", surface: "daemon", headless: true });
    expect(approvals.needsTypedConfirm(h.id)).toBe(true);

    expect(approvals.decide(h.id, true, { channel: "daemon" })).toBe(false);

    // Still pending — a failed second factor must not consume the request.
    expect(approvals.get(h.id)?.decision).toBe(null);
    expect(auditEvents().some((e) => e.event === "approval.typed_confirm" && e.data.outcome === "missing")).toBe(true);
  });

  test("a WRONG phrase is refused and audited as a mismatch", () => {
    const h = approvals.request({ tool: "delete_file", reason: "r", riskTier: "tier2", surface: "daemon", headless: true });
    expect(approvals.decide(h.id, true, { channel: "daemon" }, "approve everything")).toBe(false);
    expect(approvals.get(h.id)?.decision).toBe(null);
    expect(auditEvents().some((e) => e.event === "approval.typed_confirm" && e.data.outcome === "mismatch")).toBe(true);
  });

  test("the phrase from a DIFFERENT request does not work (no replay)", () => {
    const a = approvals.request({ tool: "delete_file", reason: "r", riskTier: "tier2", surface: "daemon", headless: true });
    const b = approvals.request({ tool: "delete_file", reason: "r", riskTier: "tier2", surface: "daemon", headless: true });
    const phraseA = approvals.typedConfirmFor(a.id)!.phrase;

    expect(approvals.decide(b.id, true, { channel: "daemon" }, phraseA)).toBe(false);
    expect(approvals.get(b.id)?.decision).toBe(null);
  });

  test("the CORRECT phrase approves, and the verification is audited", async () => {
    const h = approvals.request({ tool: "delete_file", reason: "r", args: { path: "/x" }, riskTier: "tier2", surface: "daemon", headless: true });
    const phrase = approvals.typedConfirmFor(h.id)!.phrase;

    expect(approvals.decide(h.id, true, { channel: "daemon", userId: "ops" }, phrase)).toBe(true);
    const outcome = await h.outcome;
    expect(outcome.approved).toBe(true);
    expect(auditEvents().some((e) => e.event === "approval.typed_confirm" && e.data.outcome === "verified")).toBe(true);
  });

  test("leading/trailing whitespace in the typed phrase is tolerated", () => {
    const h = approvals.request({ tool: "shell", reason: "r", riskTier: "tier2", surface: "daemon", headless: true });
    const phrase = approvals.typedConfirmFor(h.id)!.phrase;
    expect(approvals.decide(h.id, true, { channel: "daemon" }, `  ${phrase}  `)).toBe(true);
  });

  test("DENIAL never requires the second factor (denying is always safe)", async () => {
    const h = approvals.request({ tool: "delete_file", reason: "r", riskTier: "tier2", surface: "daemon", headless: true });
    expect(approvals.decide(h.id, false, { channel: "daemon" })).toBe(true);
    const outcome = await h.outcome;
    expect(outcome.approved).toBe(false);
  });

  test("the requirement is audited when the request is raised", () => {
    approvals.request({ tool: "delete_file", reason: "r", riskTier: "tier2", surface: "daemon", headless: true });
    expect(auditEvents().some((e) => e.event === "approval.typed_confirm" && e.data.outcome === "required")).toBe(true);
  });

  test("the phrase is never persisted — only its hash", () => {
    const h = approvals.request({ tool: "delete_file", reason: "r", riskTier: "tier2", surface: "daemon", headless: true });
    const phrase = approvals.typedConfirmFor(h.id)!.phrase;
    const row = store.approvalGet(h.id);
    expect(JSON.stringify(row)).not.toContain(phrase);
    // Nor does the audit trail leak it.
    expect(JSON.stringify(auditEvents())).not.toContain(phrase);
  });
});

describe("Phase 8 · Step 6 — makeApprover defaults", () => {
  test("a surface with no prompt hook is headless by default", async () => {
    const { makeApprover } = await import("../../src/control/approval-store.ts");
    const approve = makeApprover(store, { surface: "daemon", defaultTtlMs: 200 });
    // No prompt, no HTTP client: the tier-2 request must NOT self-approve. It
    // times out as a denial, which is the fail-closed direction.
    const decision = await approve({ tool: "delete_file", reason: "r", riskTier: "tier2" } as any);
    expect(decision).toBe(false);
  });
});
