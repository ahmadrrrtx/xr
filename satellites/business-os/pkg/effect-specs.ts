/**
 * XR Phase 7 · T8 — Business OS module effect-verification SPECS.
 *
 * Each module gets deterministic EFFECT tests: real writes through the
 * module's real classes against a scratch database, then an assertion on
 * the persisted side effect (row exists / value changed / event persisted /
 * audit appended). No simulated success anywhere: a test that cannot prove
 * its effect fails.
 */
import type { ModuleEffectSpec } from "./effect-verification.ts";
import { Store } from "../../src/state/workspace-store.ts";
import { BusinessDatabase } from "./src/core/database.ts";
import { ContactManager } from "./src/core/contacts.ts";
import { PipelineManager } from "./src/core/pipeline.ts";
import { BusinessEventBus } from "./src/core/bus.ts";
import { AuditTrail } from "./src/core/audit.ts";
import { OrganizationManager } from "./src/core/organization.ts";
import { RBACManager } from "./src/core/rbac.ts";
import { CRMModule } from "./src/modules/crm/index.ts";
import { SalesModule } from "./src/modules/sales/index.ts";
import { MarketingModule } from "./src/modules/marketing/index.ts";
import { SupportModule } from "./src/modules/support/index.ts";
import { ProjectsModule } from "./src/modules/projects/index.ts";
import { KnowledgeModule } from "./src/modules/knowledge/index.ts";
import { FinanceModule } from "./src/modules/finance/index.ts";
import { HRModule } from "./src/modules/hr/index.ts";
import { AnalyticsModule } from "./src/modules/analytics/index.ts";
import { SchedulingModule } from "./src/modules/scheduling/index.ts";
import { CommunicationModule } from "./src/modules/communication/index.ts";
import { DocumentsModule } from "./src/modules/documents/index.ts";
import { MeetingsModule } from "./src/modules/meetings/index.ts";
import { AutomationEngine } from "./src/modules/automation/engine.ts";

interface Wiring {
  db: BusinessDatabase;
  contacts: ContactManager;
  pipelines: PipelineManager;
  bus: BusinessEventBus;
  audit: AuditTrail;
  orgs: OrganizationManager;
  rbac: RBACManager;
  workspaceId: string;
  memberId: string;
}

/** Idempotent per store: creates org/workspace/member/pipeline ONCE. */
const wiringCache = new WeakMap<Store, Promise<Wiring>>();

async function wire(store: Store): Promise<Wiring> {
  const cached = wiringCache.get(store);
  if (cached) return cached;
  const p = (async () => {
    const db = new BusinessDatabase(store as any);
    await db.initialize(); // creates biz_* tables idempotently
    const orgs = new OrganizationManager(db);
    const rbac = new RBACManager(db);
    const contacts = new ContactManager(db);
    const pipelines = new PipelineManager(db);
    const bus = new BusinessEventBus(db);
    const audit = new AuditTrail(db);
    const org = orgs.create({ name: "Effect Org", slug: "effect-org", ownerId: "u1" });
    const wsRow = store.prepare("SELECT id FROM biz_workspaces WHERE org_id = ? LIMIT 1").get(org.id) as { id: string } | null;
    const workspaceId = wsRow?.id ?? "w1";
    const memberRow = store.prepare("SELECT id FROM biz_members WHERE org_id = ? LIMIT 1").get(org.id) as { id: string } | null;
    const memberId = memberRow?.id ?? "m1";
    // Default pipeline so sales deals have a target (default stage objects
    // carry real ids).
    try {
      pipelines.create(workspaceId, { name: "Effect Pipeline" });
    } catch {
      // pipeline already exists
    }
    return { db, contacts, pipelines, bus, audit, orgs, rbac, workspaceId, memberId };
  })();
  wiringCache.set(store, p);
  return p;
}

/** Shared assertion helpers over the scratch store. */
function rowExists(store: Store, table: string, idColumn: string, id: string): { ok: boolean; effect: string } {
  const row = store.prepare(`SELECT * FROM ${table} WHERE ${idColumn} = ?`).get(id);
  if (!row) return { ok: false, effect: `${table} row missing after operation` };
  return { ok: true, effect: `${table} row ${id} persisted` };
}

export const MODULE_EFFECT_SPECS: ModuleEffectSpec[] = [
  {
    module: "crm",
    tests: [
      {
        id: "crm.contact-persisted",
        name: "CRM contact creation persists a real row",
        run: async (store) => {
          const w = await wire(store);
          const crm = new CRMModule({ db: w.db, contacts: w.contacts, pipelines: w.pipelines, bus: w.bus, audit: w.audit });
          const contact = await crm.createContact(w.workspaceId, "u1", { name: "Effect Alice", type: "person" });
          const row = store.prepare("SELECT * FROM biz_contacts WHERE id = ?").get(contact.id) as { name: string } | null;
          if (!row) return { ok: false, effect: "contact row missing after create" };
          if (row.name !== "Effect Alice") return { ok: false, effect: `contact name mismatch: ${row.name}` };
          return { ok: true, effect: `biz_contacts row ${contact.id} persisted with name` };
        },
      },
      {
        id: "crm.audit-appended",
        name: "CRM actions append to the hash-chained audit",
        run: async (store) => {
          const w = await wire(store);
          const crm = new CRMModule({ db: w.db, contacts: w.contacts, pipelines: w.pipelines, bus: w.bus, audit: w.audit });
          await crm.createContact(w.workspaceId, "u1", { name: "Audited Contact", type: "person" });
          const auditRow = store.prepare("SELECT COUNT(*) AS c FROM biz_audit WHERE action = 'create' AND resource = 'contacts'").get() as { c: number };
          if (!auditRow || Number(auditRow.c) < 1) return { ok: false, effect: "no business audit entry appended" };
          return { ok: true, effect: `biz_audit has ${auditRow.c} contact entries` };
        },
      },
    ],
  },
  {
    module: "sales",
    tests: [
      {
        id: "sales.deal-persisted",
        name: "Deal creation persists with value",
        run: async (store) => {
          const w = await wire(store);
          const sales = new SalesModule({ db: w.db, contacts: w.contacts, pipelines: w.pipelines, bus: w.bus, audit: w.audit });
          const pipeline = w.pipelines.list(w.workspaceId)[0]!;
          const pipeRow = store.prepare("SELECT stages FROM biz_pipelines WHERE id = ?").get(pipeline.id) as { stages: string } | null;
          const stages = pipeRow ? JSON.parse(pipeRow.stages) : [];
          const stageId = stages[0]?.id ?? undefined;
          const deal = await sales.createDeal(w.workspaceId, "u1", { title: "Effect Deal", value: 42000, pipelineId: pipeline.id, stageId });
          const row = store.prepare("SELECT * FROM biz_deals WHERE id = ?").get(deal.id) as { value: number } | null;
          if (!row) return { ok: false, effect: "deal row missing after create" };
          if (Number(row.value) !== 42000) return { ok: false, effect: `deal value mismatch: ${row.value}` };
          return { ok: true, effect: `biz_deals row ${deal.id} persisted with value 42000` };
        },
      },
    ],
  },
  {
    module: "marketing",
    tests: [
      {
        id: "marketing.campaign-event-persisted",
        name: "Campaign creation persists a bus event",
        run: async (store) => {
          const w = await wire(store);
          const marketing = new MarketingModule({ db: w.db, contacts: w.contacts, bus: w.bus, audit: w.audit });
          const campaign = marketing.createCampaign(w.workspaceId, { name: "Effect Campaign", type: "email", status: "draft", workspaceId: w.workspaceId, targetAudience: {} });
          const event = store.prepare("SELECT COUNT(*) AS c FROM biz_events WHERE data LIKE ?").get(`%${campaign.id}%`) as { c: number };
          if (!event || Number(event.c) < 1) return { ok: false, effect: "campaign.created event row missing" };
          return { ok: true, effect: `campaign ${campaign.id} event persisted in biz_events` };
        },
      },
    ],
  },
  {
    module: "support",
    tests: [
      {
        id: "support.ticket-persisted",
        name: "Ticket creation persists",
        run: async (store) => {
          const w = await wire(store);
          const support = new SupportModule({ db: w.db, bus: w.bus, audit: w.audit });
          const ticket = await support.createTicket(w.workspaceId, { subject: "Effect Ticket", description: "Effect ticket body" });
          return rowExists(store, "biz_tickets", "id", ticket.id);
        },
      },
    ],
  },
  {
    module: "projects",
    tests: [
      {
        id: "projects.project-persisted",
        name: "Project creation persists",
        run: async (store) => {
          const w = await wire(store);
          const projects = new ProjectsModule({ db: w.db, bus: w.bus, audit: w.audit });
          const project = await projects.createProject(w.workspaceId, { name: "Effect Project", ownerId: w.memberId });
          return rowExists(store, "biz_projects", "id", project.id);
        },
      },
    ],
  },
  {
    module: "finance",
    tests: [
      {
        id: "finance.expense-persisted",
        name: "Expense recording persists a ledger entry",
        run: async (store) => {
          const w = await wire(store);
          const finance = new FinanceModule({ db: w.db, bus: w.bus, audit: w.audit });
          const expense = await finance.createExpense(w.workspaceId, {
            category: "travel", description: "Effect expense", amount: 150, date: new Date().toISOString(),
          });
          const row = store.prepare("SELECT * FROM biz_expenses WHERE id = ?").get(expense.id) as { amount: number } | null;
          if (!row) return { ok: false, effect: "expense row missing after record" };
          if (Number(row.amount) !== 150) return { ok: false, effect: `expense amount mismatch: ${row.amount}` };
          return { ok: true, effect: `biz_expenses row ${expense.id} persisted (150)` };
        },
      },
    ],
  },
  {
    module: "hr",
    tests: [
      {
        id: "hr.employee-persisted",
        name: "Employee creation persists",
        run: async (store) => {
          const w = await wire(store);
          const hr = new HRModule({ db: w.db, bus: w.bus });
          const employee = await hr.createEmployee(w.workspaceId, { memberId: w.memberId, position: "Engineer" });
          return rowExists(store, "biz_employees", "id", employee.id);
        },
      },
    ],
  },
  {
    module: "analytics",
    tests: [
      {
        id: "analytics.report-persisted",
        name: "Report snapshot persists",
        run: async (store) => {
          const w = await wire(store);
          const analytics = new AnalyticsModule({ db: w.db, bus: w.bus });
          const report = analytics.createReport(w.workspaceId, { name: "Effect Report", type: "sales", config: { metrics: ["revenue"], dimensions: ["day"], filters: {}, dateRange: { start: "2026-01-01", end: "2026-01-31" } } });
          return rowExists(store, "biz_reports", "id", report.id);
        },
      },
    ],
  },
  {
    module: "scheduling",
    tests: [
      {
        id: "scheduling.event-persisted",
        name: "Scheduled event persists",
        run: async (store) => {
          const w = await wire(store);
          const scheduling = new SchedulingModule({ db: w.db, bus: w.bus });
          const event = scheduling.createEvent(w.workspaceId, {
            title: "Effect Event", startTime: new Date().toISOString(), endTime: new Date(Date.now() + 3600_000).toISOString(), memberId: w.memberId,
          });
          return rowExists(store, "biz_calendar_events", "id", event.id);
        },
      },
    ],
  },
  {
    module: "communication",
    tests: [
      {
        id: "communication.notification-persisted",
        name: "Notification persists as an event",
        run: async (store) => {
          const w = await wire(store);
          const communication = new CommunicationModule({ db: w.db, bus: w.bus });
          const notification = communication.notify(w.workspaceId, { recipientId: "u1", type: "info", title: "Effect Note", body: "body" });
          const row = store.prepare("SELECT * FROM biz_events WHERE id = ?").get(notification.id);
          if (!row) return { ok: false, effect: "notification event row missing" };
          return { ok: true, effect: `biz_events row ${notification.id} persisted` };
        },
      },
    ],
  },
  {
    module: "documents",
    tests: [
      {
        id: "documents.document-persisted",
        name: "Document persists",
        run: async (store) => {
          const w = await wire(store);
          const documents = new DocumentsModule({ db: w.db, bus: w.bus });
          const doc = documents.createDocument(w.workspaceId, { title: "Effect Doc", content: "body", ownerId: w.memberId });
          return rowExists(store, "biz_documents", "id", doc.id);
        },
      },
    ],
  },
  {
    module: "meetings",
    tests: [
      {
        id: "meetings.meeting-persisted",
        name: "Meeting persists",
        run: async (store) => {
          const w = await wire(store);
          const meetings = new MeetingsModule({ db: w.db, bus: w.bus });
          const meeting = await meetings.createMeeting(w.workspaceId, {
            title: "Effect Meeting", startTime: new Date().toISOString(), endTime: new Date(Date.now() + 3600_000).toISOString(),
            organizerId: w.memberId, attendees: [],
          });
          return rowExists(store, "biz_meetings", "id", meeting.id);
        },
      },
    ],
  },
  {
    module: "knowledge",
    tests: [
      {
        id: "knowledge.article-persisted",
        name: "Knowledge article persists",
        run: async (store) => {
          const w = await wire(store);
          const knowledge = new KnowledgeModule({ db: w.db, bus: w.bus });
          const article = await knowledge.createArticle(w.workspaceId, { title: "Effect Article", content: "body", authorId: w.memberId });
          return rowExists(store, "biz_knowledge_articles", "id", article.id);
        },
      },
    ],
  },
  {
    module: "automation",
    tests: [
      {
        id: "automation.automation-persisted",
        name: "Automation definition persists",
        run: async (store) => {
          const w = await wire(store);
          const engine = new AutomationEngine({ db: w.db, bus: w.bus, audit: w.audit } as any);
          const automation = engine.createAutomation(w.workspaceId, {
            name: "Effect Automation",
            trigger: { type: "manual" },
            steps: [{ id: "s1", kind: "send_notification", title: "Notify" }],
          } as never);
          return rowExists(store, "biz_automations", "id", automation.id);
        },
      },
    ],
  },
  {
    module: "ai-workers",
    tests: [
      {
        id: "ai-workers.worker-persisted",
        name: "AI worker deployment persists",
        run: async (store) => {
          const w = await wire(store);
          const { AIWorkersModule, WORKER_DEFINITIONS } = await import("./src/modules/ai-workers/index.ts");
          const workers = new AIWorkersModule({ db: w.db, bus: w.bus, audit: w.audit, rbac: w.rbac } as any);
          const definition = WORKER_DEFINITIONS[0] ?? {
            role: "sales_director", name: "Sales Director", description: "Runs sales", systemPrompt: "You are a sales director.",
            capabilities: ["crm:read", "sales:write"], permissions: [], memoryEnabled: true, researchEnabled: false,
            voiceEnabled: false, computerControlEnabled: false, schedule: null, avatar: null,
          };
          const worker = await workers.deployWorker(w.workspaceId, definition as never, {});
          return rowExists(store, "biz_workers", "id", worker.id);
        },
      },
    ],
  },
];
