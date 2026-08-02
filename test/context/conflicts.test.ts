/**
 * XR 4.6 — Phase 6 · T4: conflict resolution + selective forgetting.
 *
 * Asserted effects (Part 13.4):
 *   1. Supersession resolves automatically by policy — and is RECORDED.
 *   2. A plain contradiction-injection resolves only with a user decision:
 *      both items stay retrievable and honestly labelled until then.
 *   3. Resolution changes precedence, never deletes: the loser is superseded
 *      (inspectable), retrieval ranks the winner first, and nothing is
 *      silently corrupted.
 *   4. Resolution NEVER changes trust (rule 4).
 *   5. Selective forgetting: hard-expiry hides an item from retrieval without
 *      deleting it; the ops ledger makes the action undoable.
 *   6. Undo of a resolution restores exact precedence + marks the resolution.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { ServiceRegistry } from "../../src/core/service-registry.ts";
import { ContextRepository, adaptStoreForContext } from "../../src/context/repository.ts";
import { ContextRetrieval } from "../../src/context/retrieval.ts";
import { ContextService } from "../../src/context/service.ts";
import { buildGrant, makeScope } from "../../src/context/policy.ts";
import { LEXICAL_ROUTE } from "../../src/context/embedding.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-ctx-con-"));
  process.env.XR_HOME = join(tmp, "home");
});
afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

function freshService(ws = "default") {
  const path = join(tmp, `con-${Math.random().toString(36).slice(2)}.db`);
  const store = new Store(ws, path);
  const registry = new ServiceRegistry();
  const svc = new ContextService(registry, store, { lexicalOnly: true });
  return { store, svc };
}

function seedContradiction(repo: ContextRepository): { a: string; b: string } {
  const a = repo.insertItem({
    id: "fact_a",
    type: "knowledge",
    content: "The Q1 revenue target is 1.2M USD.",
    scope: { workspaceId: "default", projectScope: "proj" },
    trustStatus: "source_evidence",
    consentState: "approved",
    provenanceKind: "business_record",
    actorKind: "user",
    links: { taskId: "task-q1" },
  });
  const b = repo.insertItem({
    id: "fact_b",
    type: "knowledge",
    content: "The Q1 revenue target is 1.35M USD (revised).",
    scope: { workspaceId: "default", projectScope: "proj" },
    trustStatus: "source_evidence",
    consentState: "approved",
    provenanceKind: "business_record",
    actorKind: "user",
    links: { taskId: "task-q1" },
  });
  // Recorded contradiction on both sides.
  repo.setContradictedBy("fact_a", ["fact_b"]);
  repo.setContradictedBy("fact_b", ["fact_a"]);
  return { a, b };
}

function theGrant() {
  return buildGrant(
    {
      requester: { kind: "agent", id: "a1", role: "coder" },
      scope: makeScope({ workspaceId: "default", projectScope: "proj" }),
      maxItems: 48,
      maxChars: 24_000,
    },
    { memoryScopeKind: "user" },
  );
}

describe("conflict resolution", () => {
  test("contradiction-injection: both sides visible pre-resolution, no silent corruption", async () => {
    const { svc } = freshService();
    const { a, b } = seedContradiction(svc.repository);

    const open = svc.openConflicts("proj");
    const pair = open.find((o) => (o.finding.itemId === a && o.finding.otherId === b) || (o.finding.itemId === b && o.finding.otherId === a));
    expect(pair).toBeDefined();
    expect(pair!.resolution).toBeNull(); // open — NOT auto-decided

    // Both stay retrievable and honestly labelled before any decision.
    const retrieval = new ContextRetrieval(svc.repository, LEXICAL_ROUTE);
    const res = await retrieval.retrieve({
      queryIntent: "q1 target",
      query: "what is the Q1 revenue target",
      grant: theGrant(),
      lexicalOnly: true,
    });
    const ids = res.items.map((r) => r.item.id);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    const notes = res.items.map((r) => r.explanation.policyReason).join(" | ");
    expect(notes).toContain("contradicted");
  });

  test("user resolution keep_b: precedence changes, loser preserved, trust untouched", async () => {
    const { svc } = freshService();
    const { a, b } = seedContradiction(svc.repository);
    const trustBefore = svc.repository.getItem(a)!.trustStatus;

    const res = svc.resolveConflict(a, b, "keep_b", { reason: "revised plan adopted", actor: "user" });
    expect(res.ok).toBe(true);
    expect(res.winnerId).toBe(b);
    expect(res.loserId).toBe(a);

    // Loser is superseded (precedence), still present (never deleted).
    const loser = svc.repository.getItem(a)!;
    expect(loser.supersededBy).toBe(b);
    expect(loser.content).toContain("1.2M");
    // Trust never moved (rule 4).
    expect(loser.trustStatus).toBe(trustBefore);

    // Resolution recorded + open-conflict status flips.
    const resolutions = svc.repository.listResolutions("default");
    expect(resolutions.length).toBe(1);
    expect(resolutions[0]!.decided_by).toBe("user");

    // Retrieval now ranks the winner strictly first.
    const retrieval = new ContextRetrieval(svc.repository, LEXICAL_ROUTE);
    const after = await retrieval.retrieve({
      queryIntent: "q1 target",
      query: "Q1 revenue target",
      grant: theGrant(),
      lexicalOnly: true,
    });
    expect(after.items[0]!.item.id).toBe(b);
    const loserHit = after.items.find((r) => r.item.id === a);
    expect(loserHit!.explanation.policyReason).toContain("superseded");
  });

  test("undo of a resolution restores the prior precedence exactly", async () => {
    const { svc } = freshService();
    const { a, b } = seedContradiction(svc.repository);
    svc.resolveConflict(a, b, "keep_b", { reason: "test", actor: "user" });
    expect(svc.repository.getItem(a)!.supersededBy).toBe(b);

    const undone = svc.undoOp(undefined, "user");
    expect(undone.ok).toBe(true);

    const restored = svc.repository.getItem(a)!;
    expect(restored.supersededBy).toBeNull();
    expect(restored.content).toContain("1.2M");

    // And the undo itself is visible in history (append-only evidence).
    const history = svc.opsHistory();
    expect(history.some((o) => o.op.startsWith("undo"))).toBe(true);
  });

  test("selective forgetting hides without deleting, and is undoable", async () => {
    const { svc } = freshService();
    const id = svc.repository.insertItem({
      id: "forget_me",
      type: "memory",
      content: "the user prefers morning standups",
      scope: { workspaceId: "default", projectScope: "proj" },
      trustStatus: "approved_memory",
      consentState: "approved",
      provenanceKind: "user_input",
      actorKind: "user",
    });

    const out = svc.forgetItem(id, { reason: "user asked", actor: "user" });
    expect(out.ok).toBe(true);

    // Hidden from retrieval...
    const retrieval = new ContextRetrieval(svc.repository, LEXICAL_ROUTE);
    const res = await retrieval.retrieve({ queryIntent: "prefs", query: "morning standups preference", grant: theGrant(), lexicalOnly: true });
    expect(res.items.map((r) => r.item.id)).not.toContain(id);
    // ...never deleted.
    expect(svc.repository.getItem(id)!.content).toContain("standups");
    expect(svc.repository.getItem(id)!.freshness.label).toBe("expired");

    // Undo restores retrieval.
    const undone = svc.undoOp(undefined, "user");
    expect(undone.ok).toBe(true);
    const back = await retrieval.retrieve({ queryIntent: "prefs", query: "morning standups preference", grant: theGrant(), lexicalOnly: true });
    expect(back.items.map((r) => r.item.id)).toContain(id);
  });

  test("policy auto-resolves supersession — recorded, not silent", () => {
    const { svc } = freshService();
    const repo = svc.repository;
    const orig = repo.insertItem({
      id: "s_orig",
      type: "knowledge",
      content: "V-104 is the billing vendor of record.",
      scope: { workspaceId: "default", projectScope: "proj" },
      trustStatus: "source_evidence",
      consentState: "approved",
      provenanceKind: "business_record",
      actorKind: "user",
      links: { taskId: "task-vendor" },
    });
    const corr = repo.insertItem({
      id: "s_corr",
      type: "knowledge",
      content: "V-209 replaced V-104 as billing vendor of record.",
      scope: { workspaceId: "default", projectScope: "proj" },
      trustStatus: "source_evidence",
      consentState: "approved",
      provenanceKind: "business_record",
      actorKind: "user",
      links: { taskId: "task-vendor" },
    });
    repo.supersede(orig, corr);

    const open = svc.openConflicts("proj");
    const finding = open.find((o) => o.finding.itemId === orig);
    expect(finding).toBeDefined();
    expect(finding!.resolution).not.toBeNull();
    expect(finding!.resolution!.decided_by).toBe("policy");
  });
});
