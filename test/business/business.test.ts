/**
 * XR Business OS — Integration Suite (0.5 Business OS + 0.2 Storage Unification)
 *
 * Unlike the legacy suite (which ran on a raw :memory: Database), this suite
 * constructs BusinessOS with a REAL WorkspaceStore — exactly the way
 * kernel.bootstrap() does it. That closes the loop on two integrations:
 *   - BusinessDatabase works through WorkspaceStore's prepare/transaction
 *     adapter surface (0.5), and
 *   - every business table lands inside the SAME unified xr.db file (0.2).
 *
 * (Supersedes src/tests/business.test.ts, which used a throwaway in-memory DB.)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BusinessOS } from "../../src/business/index.ts";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { CORE_VERSION, CODENAME, PKG } from "../../src/core/version.ts";

let tmp: string;
let store: WorkspaceStore;
let biz: BusinessOS;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "xr-business-"));
  // The kernel path: BusinessOS rides the unified WorkspaceStore, not a raw DB.
  store = new WorkspaceStore("biz-test", join(tmp, "xr.db"));
  biz = new BusinessOS({ db: store });
  await biz.initialize();
});

afterAll(() => {
  try {
    store.close();
  } catch {}
  rmSync(tmp, { recursive: true, force: true });
});

function workspaceIdFor(userId: string, orgIndex = 0): string {
  const org = biz.orgs.listForUser(userId)[orgIndex];
  return biz.db.prepare(
    "SELECT id FROM biz_workspaces WHERE org_id = ? LIMIT 1",
  ).get(org!.id)?.id as string;
}

// ── 0.5 / 0.2 integration proofs ────────────────────────────────────────────

describe("Storage unification integration (0.5 on 0.2)", () => {
  test("initializes through the WorkspaceStore adapter surface", () => {
    expect(biz.isInitialized()).toBe(true);
    // Reads via the adapter must see the biz tables
    const row = store.prepare(
      "SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name LIKE 'biz_%'",
    ).get() as { c: number };
    expect(row.c).toBeGreaterThan(10);
  });

  test("business tables live INSIDE the same unified xr.db file", () => {
    // Prove persistence into the store's own file by opening it independently.
    const raw = new Database(store.dbPath, { readonly: true });
    const row = raw.query(
      "SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name LIKE 'biz_%'",
    ).get() as { c: number };
    raw.close();
    expect(row.c).toBeGreaterThan(10);
  });

  test("initialize is idempotent", async () => {
    await biz.initialize();
    await biz.initialize();
    expect(biz.isInitialized()).toBe(true);
  });

  test("XR audit chain of the unified store stays intact", async () => {
    store.audit("business.integration", { ok: true });
    expect(store.verifyChain().valid).toBe(true);
  });
});

// ── Identity (0.1) ──────────────────────────────────────────────────────────

describe("Identity unification (0.1)", () => {
  test("version comes from the single source of truth, not a hardcoded copy", () => {
    const version = biz.getVersion();
    expect(version.version).toBe(CORE_VERSION);
    expect(version.codename).toBe(CODENAME);
    expect(version.pkg).toBe(PKG.name);
    expect(version.modules.length).toBe(15);
  });

  test("system health is reported after init", () => {
    const health = biz.getHealth();
    expect(health.status).toBe("healthy");
    expect(Object.values(health.modules).every(Boolean)).toBe(true);
  });
});

// ── Organization & RBAC ─────────────────────────────────────────────────────

describe("Organization Management", () => {
  let orgId: string;

  test("creates an organization with a free plan by default", () => {
    const org = biz.orgs.create({ name: "Test Corp", slug: "test-corp", ownerId: "user-1" });
    orgId = org.id;
    expect(org.name).toBe("Test Corp");
    expect(org.plan).toBe("free");
  });

  test("retrieves by id and by slug", () => {
    expect(biz.orgs.getById(orgId)?.slug).toBe("test-corp");
    expect(biz.orgs.getBySlug("test-corp")?.id).toBe(orgId);
  });

  test("lists organizations for the owner", () => {
    expect(biz.orgs.listForUser("user-1").length).toBeGreaterThan(0);
  });

  test("RBAC: non-member is denied; member of org passes an allowed action", () => {
    expect(biz.rbac.checkAccess("nonexistent", "contacts", "read").allowed).toBe(false);
    const members = biz.rbac.listMembers(orgId);
    if (members.length > 0) {
      expect(biz.rbac.checkAccess(members[0].id, "contacts", "create").allowed).toBe(true);
    }
  });
});

// ── Contacts with workspace isolation ───────────────────────────────────────

describe("Contacts (with workspace isolation — data integrity)", () => {
  let ws1: string;
  let ws2: string;
  let contactId: string;

  beforeAll(() => {
    ws1 = workspaceIdFor("user-1");
    // A second org + workspace to prove cross-workspace isolation. Resolve the
    // new workspace through the created org's id (not listForUser's index):
    // listForUser orders by org NAME, so indices shift after every insert.
    const otherOrg = biz.orgs.create({ name: "Other Corp", slug: "other-corp", ownerId: "user-1" });
    ws2 = biz.db.prepare(
      "SELECT id FROM biz_workspaces WHERE org_id = ? LIMIT 1",
    ).get(otherOrg.id)?.id as string;
    expect(ws2).toBeTruthy();
    expect(ws1).not.toBe(ws2);
  });

  test("create + get + update + search round-trips", () => {
    const contact = biz.contacts.create(ws1, {
      type: "person", name: "John Doe", email: "john@example.com", company: "Acme",
    });
    contactId = contact.id;
    expect(biz.contacts.getById(contactId)?.email).toBe("john@example.com");

    const updated = biz.contacts.update(contactId, { title: "CEO" });
    expect(updated?.title).toBe("CEO");

    expect(biz.contacts.search(ws1, "John").length).toBeGreaterThan(0);
  });

  test("a contact from workspace A is invisible in workspace B", () => {
    const inB = biz.contacts.search(ws2, "John");
    expect(inB.some((c) => c.id === contactId)).toBe(false);
  });

  test("notes and stats work", () => {
    const note = biz.contacts.addNote(contactId, { authorId: "user-1", content: "great call" });
    expect(note.content).toBe("great call");
    expect(biz.contacts.getStats(ws1).total).toBeGreaterThan(0);
  });
});

// ── Pipeline, Finance, Support, Projects ────────────────────────────────────

describe("Core modules (CRM-adjacent flows)", () => {
  test("pipeline default + deal movement + stats", () => {
    const ws = workspaceIdFor("user-1");
    const pipeline = biz.pipelines.getOrCreateDefault(ws);
    expect(pipeline.isDefault).toBe(true);
    expect(pipeline.stages.length).toBeGreaterThan(0);

    const deal = biz.pipelines.createDeal(ws, { pipelineId: pipeline.id, title: "Big Deal", value: 50000 });
    expect(deal.value).toBe(50000);
    expect(biz.pipelines.moveDeal(deal.id, "qualified")?.stageId).toBe("qualified");
    expect(biz.pipelines.getStats(ws).totalDeals).toBeGreaterThan(0);
  });

  test("finance invoice math is exact", async () => {
    const ws = workspaceIdFor("user-1");
    const client = biz.contacts.create(ws, { type: "person", name: "Invoice Client" });
    const invoice = await biz.finance.createInvoice(ws, {
      contactId: client.id,
      lineItems: [{ description: "Consulting", quantity: 10, unitPrice: 150 }],
    });
    expect(invoice.number).toMatch(/^INV-/);
    expect(invoice.total).toBe(1500);
  });

  test("support tickets get sequential numbers", async () => {
    const ws = workspaceIdFor("user-1");
    const ticket = await biz.support.createTicket(ws, {
      subject: "Help", description: "Setup help needed", priority: "high",
    });
    expect(ticket.number).toBeGreaterThanOrEqual(1);
    expect(biz.support.getStats(ws).total).toBeGreaterThan(0);
  });

  test("projects + tasks CRUD", async () => {
    const ws = workspaceIdFor("user-1");
    const project = await biz.projects.createProject(ws, { name: "Website", ownerId: "user-1" });
    const task = await biz.projects.createTask(ws, { projectId: project.id, title: "Design", priority: "high" });
    expect(task.projectId).toBe(project.id);
    expect(biz.projects.listTasks(ws).data.length).toBeGreaterThan(0);
  });
});

// ── AI Workers ──────────────────────────────────────────────────────────────

describe("AI Workers", () => {
  test("deploys the complete default workforce", () => {
    const ws = workspaceIdFor("user-1");
    const workers = biz.deployAllWorkers(ws);
    expect(workers.length).toBe(11);
    const roles = biz.workers.listWorkers(ws).map((w) => w.role);
    for (const role of [
      "ceo_advisor", "sales_director", "marketing_director", "financial_analyst",
      "hr_manager", "project_manager", "support_manager", "operations_manager",
      "legal_assistant", "research_analyst", "growth_strategist",
    ]) {
      expect(roles as string[]).toContain(role);
    }
  });
});

// ── Integrations, security policies, audit trail ────────────────────────────

describe("Integrations & security", () => {
  test("connector registry is broad and categorized", () => {
    expect(biz.connectors.list().length).toBeGreaterThan(20);
    for (const cat of ["communication", "calendar", "development", "storage", "crm_erp", "payments", "analytics"]) {
      expect(biz.connectors.categories()).toContain(cat);
    }
    expect(biz.connectors.get("gmail")?.authType).toBe("oauth2");
  });

  test("security policies enforce least privilege and workspace isolation", () => {
    const policies = biz.security.listPolicies();
    expect(policies.find((p) => p.id === "least_privilege")?.enabled).toBe(true);
    expect(policies.find((p) => p.id === "data_isolation")?.enabled).toBe(true);
  });

  test("business audit trail is hash-chained and verifies", () => {
    const entry = biz.audit.log({
      orgId: "org-audit", actorId: "user-1", actorType: "member",
      action: "create", resource: "contacts", resourceId: "c-1",
    });
    expect(entry.hash).toHaveLength(64);
    expect(biz.audit.verify("org-audit").valid).toBe(true);
  });
});
