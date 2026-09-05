/**
 * XR Business OS (optional extension) — adversarial boundary tests (R-1, A-5).
 *
 * The A-5 finding demanded authz/adversarial parity for the enterprise tier.
 * The current repo has no tenants/authz-agents/pii modules in src/enterprise
 * (the audit's module list predates the 7.x consolidation); the boundary that
 * actually exists today for the optional Business OS extension is:
 *
 *   · RBACManager        — role/custom-permission adjudication
 *   · ApprovalEscalation — single-decision, expiry-fail-closed approvals
 *   · Org/workspace      — member and listing isolation
 *
 * These tests pin the guarantees adversarially: escalation attempts, replay,
 * expiry abuse, and "a denied attempt changes nothing".
 *
 * Enforcement reality (documented, not hidden): RBAC is wired for AI workers
 * and operating-layer mutations; plain CRUD modules trust the single human
 * owner of this local install. The service-level semantics pinned here are
 * what any future caller-facing gate relies on.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { BusinessOS } from "../../extensions/business-os/src/index.ts";
import type { Member, OrgRole } from "../../extensions/business-os/src/core/types.ts";

let tmp: string;
let store: WorkspaceStore;
let biz: BusinessOS;
let orgId: string;
let wsId: string;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "xr-biz-adv-"));
  process.env.XR_HOME = tmp;
  store = new WorkspaceStore("biz-adv", join(tmp, "xr.db"));
  biz = new BusinessOS({ db: store });
  await biz.initialize();
  const org = biz.orgs.create({ name: "Adversary Corp", slug: "adv-corp", ownerId: "owner-user" });
  orgId = org.id;
  wsId = (biz.db.prepare("SELECT id FROM biz_workspaces WHERE org_id = ? LIMIT 1").get(orgId) as { id: string }).id;
});

afterEach(() => {
  try { store.close(); } catch { /* already closed */ }
  rmSync(tmp, { recursive: true, force: true });
});

function addMember(userId: string, role: OrgRole, workspaces: { workspaceId: string; role: OrgRole }[] = []): Member {
  return biz.rbac.addMember(orgId, { userId, email: `${userId}@adv.test`, name: userId, role, workspaces });
}

describe("RBACManager adversarial", () => {
  test("role escalation: viewer cannot delete; denied attempt mutates nothing", () => {
    const viewer = addMember("viewer-user", "viewer");
    const before = JSON.stringify(biz.rbac.getMember(viewer.id));

    const denied = biz.rbac.checkAccess(viewer.id, "contacts", "delete");
    expect(denied.allowed).toBe(false);
    expect(() => biz.rbac.assertAccess(viewer.id, "contacts", "delete")).toThrow(/Access denied/);

    // The denied attempt itself made no state change (role intact, no perms written).
    expect(JSON.stringify(biz.rbac.getMember(viewer.id))).toBe(before);
  });

  test("guest role is locked out of business resources entirely", () => {
    const guest = addMember("guest-user", "guest");
    for (const resource of ["contacts", "deals", "invoices", "workers"]) {
      expect(biz.rbac.checkAccess(guest.id, resource, "read").allowed).toBe(false);
    }
    // Only knowledge:read is a guest's world.
    expect(biz.rbac.checkAccess(guest.id, "knowledge", "read").allowed).toBe(true);
    expect(biz.rbac.checkAccess(guest.id, "knowledge", "create").allowed).toBe(false);
  });

  test("disabled member is denied even for actions their role allows", () => {
    const manager = addMember("manager-user", "manager");
    expect(biz.rbac.checkAccess(manager.id, "deals", "delete").allowed).toBe(true);

    biz.rbac.disableMember(manager.id);
    const after = biz.rbac.checkAccess(manager.id, "deals", "delete");
    expect(after.allowed).toBe(false);
    expect(after.reason).toContain("not active");
  });

  test("role change is the ONLY escalation vector, and it takes effect atomically", () => {
    const viewer = addMember("promote-me", "viewer");
    expect(biz.rbac.checkAccess(viewer.id, "contacts", "delete").allowed).toBe(false);

    // RBACManager mutation methods carry no internal authz (caller = the local
    // owner/CLI; ai-workers go through governance). Pin the semantic: once the
    // role row changes, adjudication follows the NEW role immediately and
    // completely — no stale cached permissions.
    biz.rbac.updateMemberRole(viewer.id, "manager");
    expect(biz.rbac.checkAccess(viewer.id, "deals", "delete").allowed).toBe(true);
    expect(biz.rbac.getMember(viewer.id)!.role).toBe("manager");
  });

  test("custom permission entry: explicit narrow grant OVERRIDES broad role default", () => {
    const admin = addMember("scoped-admin", "admin");
    // Role default would allow delete everywhere ('*').
    expect(biz.rbac.checkAccess(admin.id, "invoices", "delete").allowed).toBe(true);

    // A custom entry for one resource is an explicit contract for THAT resource.
    biz.rbac.setPermissions(admin.id, [{ resource: "invoices", actions: ["read"] }]);

    expect(biz.rbac.checkAccess(admin.id, "invoices", "delete").allowed).toBe(false); // override caps the role
    expect(biz.rbac.checkAccess(admin.id, "invoices", "read").allowed).toBe(true);
    expect(biz.rbac.checkAccess(admin.id, "contacts", "delete").allowed).toBe(true); // role still governs elsewhere
  });

  test("custom wildcard with 'admin' action is owner-equivalent (pinned semantics)", () => {
    const member = addMember("wildcard-user", "member");
    expect(biz.rbac.checkAccess(member.id, "invoices", "delete").allowed).toBe(false);

    // 'admin' in a custom permission means "any action on the resource" — pinned
    // so a future tightening cannot silently break callers (or go unnoticed).
    biz.rbac.setPermissions(member.id, [{ resource: "*", actions: ["admin"] }]);
    expect(biz.rbac.checkAccess(member.id, "invoices", "delete").allowed).toBe(true);
    expect(biz.rbac.checkAccess(member.id, "settings", "update").allowed).toBe(true);
  });

  test("org isolation: member lists do not leak across organizations", () => {
    const other = biz.orgs.create({ name: "Other Co", slug: "other-co", ownerId: "other-owner" });
    addMember("adv-member", "member");
    biz.rbac.addMember(other.id, { userId: "other-member", email: "o@x.test", name: "other-member", role: "member" });

    const advIds = biz.rbac.listMembers(orgId).map((m) => m.userId);
    const otherIds = biz.rbac.listMembers(other.id).map((m) => m.userId);
    expect(advIds).toContain("adv-member");
    expect(advIds).not.toContain("other-member");
    expect(otherIds).toContain("other-member");
    expect(otherIds).not.toContain("adv-member");
  });
});

describe("ApprovalEscalationService adversarial", () => {
  function createApproval(overrides: Record<string, unknown> = {}) {
    return biz.approvals.createRequest({
      kind: "approval",
      orgId,
      workspaceId: wsId,
      requestedBy: { kind: "worker", id: "worker-1" },
      title: "Send invoice batch",
      description: "Worker wants to send 24 invoices",
      severity: "critical",
      recipients: [],
      ...overrides,
    });
  }

  test("replay: a decided approval cannot be decided again", () => {
    const req = createApproval();
    const decided = biz.approvals.decide(req.approvalId, { decidedBy: "owner-user", outcome: "approved" });
    expect(decided.status).toBe("approved");

    // Replay attempt — approved once, approved never again.
    expect(() => biz.approvals.decide(req.approvalId, { decidedBy: "attacker", outcome: "approved" }))
      .toThrow(/already decided/);
    // …and flipping to denied after approval is equally impossible.
    expect(() => biz.approvals.decide(req.approvalId, { decidedBy: "owner-user", outcome: "denied" }))
      .toThrow(/already decided/);
    expect(biz.approvals.getRequest(req.approvalId)!.decision!.decidedBy).toBe("owner-user");
  });

  test("expiry abuse: an expired approval cannot be approved (fail-closed)", () => {
    const req = createApproval({ expiresInMs: -1000 }); // already expired at creation
    expect(() => biz.approvals.decide(req.approvalId, { decidedBy: "owner-user", outcome: "approved" }))
      .toThrow(/expired/);
    // The honest terminal state is recorded — no lingering 'pending' to exploit later.
    expect(biz.approvals.getRequest(req.approvalId)!.status).toBe("expired");
  });

  test("expireStale flips stale pendings; fresh pendings survive", () => {
    const stale = createApproval({ expiresInMs: -1000 });
    const fresh = createApproval({ title: "Fresh request" });
    const flipped = biz.approvals.expireStale();
    expect(flipped).toBeGreaterThanOrEqual(1);
    expect(biz.approvals.getRequest(stale.approvalId)!.status).toBe("expired");
    expect(biz.approvals.getRequest(fresh.approvalId)!.status).toBe("pending");
  });

  test("workspace isolation: pending approvals do not leak across workspaces", () => {
    const req = createApproval();
    const listed = biz.approvals.listPending(wsId);
    expect(listed.some((r) => r.approvalId === req.approvalId)).toBe(true);
    expect(biz.approvals.listPending("ws_nonexistent").some((r) => r.approvalId === req.approvalId)).toBe(false);
  });

  test("deciding a nonexistent approval fails loudly, creates nothing", () => {
    expect(() => biz.approvals.decide("apr_ghost", { decidedBy: "x", outcome: "approved" }))
      .toThrow(/not found/);
    expect(biz.approvals.getRequest("apr_ghost")).toBeNull();
  });
});
