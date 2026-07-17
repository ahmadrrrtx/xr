/**
 * XR Business OS — Core Tests
 */

import { describe, test, expect, beforeAll, beforeEach } from 'bun:test';
import { BusinessOS } from '../business/index.js';

describe('XR Business OS Core', () => {
  let biz: BusinessOS;

  beforeAll(async () => {
    // Use in-memory SQLite for testing
    const Database = (await import('bun:sqlite')).Database;
    const db = new Database(':memory:');
    biz = new BusinessOS({ db });
    await biz.initialize();
  });

  describe('Initialization', () => {
    test('should initialize successfully', () => {
      expect(biz.isInitialized()).toBe(true);
    });

    test('should have all modules healthy', () => {
      const health = biz.getHealth();
      expect(health.status).toBe('healthy');
      expect(Object.values(health.modules).every(Boolean)).toBe(true);
    });

    test('should return correct version', () => {
      const version = biz.getVersion();
      expect(version.version).toBe('3.1.5');
      expect(version.stage).toContain('XR 3.1.5');
      expect(version.modules.length).toBe(15);
    });
  });

  describe('Organization Management', () => {
    let orgId: string;

    test('should create an organization', () => {
      const org = biz.orgs.create({
        name: 'Test Corp',
        slug: 'test-corp',
        ownerId: 'user-1',
      });
      orgId = org.id;
      expect(org.name).toBe('Test Corp');
      expect(org.slug).toBe('test-corp');
      expect(org.plan).toBe('free');
    });

    test('should retrieve organization by ID', () => {
      const org = biz.orgs.getById(orgId);
      expect(org).not.toBeNull();
      expect(org!.name).toBe('Test Corp');
    });

    test('should retrieve organization by slug', () => {
      const org = biz.orgs.getBySlug('test-corp');
      expect(org).not.toBeNull();
      expect(org!.id).toBe(orgId);
    });

    test('should list organizations for a user', () => {
      const orgs = biz.orgs.listForUser('user-1');
      expect(orgs.length).toBeGreaterThan(0);
    });
  });

  describe('RBAC', () => {
    test('owner should have full access', () => {
      const members = biz.rbac.listMembers(biz.orgs.listForUser('user-1')[0]?.id ?? '');
      if (members.length > 0) {
        const result = biz.rbac.checkAccess(members[0].id, 'contacts', 'create');
        expect(result.allowed).toBe(true);
      }
    });

    test('non-member should be denied', () => {
      const result = biz.rbac.checkAccess('nonexistent', 'contacts', 'read');
      expect(result.allowed).toBe(false);
    });
  });

  describe('Contacts', () => {
    let workspaceId: string;
    let contactId: string;

    beforeAll(() => {
      const org = biz.orgs.listForUser('user-1')[0];
      workspaceId = biz.db.prepare(
        'SELECT id FROM biz_workspaces WHERE org_id = ? LIMIT 1'
      ).get(org!.id)?.id as string;
    });

    test('should create a contact', () => {
      const contact = biz.contacts.create(workspaceId, {
        type: 'person',
        name: 'John Doe',
        email: 'john@example.com',
        company: 'Acme Corp',
      });
      contactId = contact.id;
      expect(contact.name).toBe('John Doe');
      expect(contact.email).toBe('john@example.com');
    });

    test('should retrieve contact by ID', () => {
      const contact = biz.contacts.getById(contactId);
      expect(contact).not.toBeNull();
      expect(contact!.name).toBe('John Doe');
    });

    test('should update contact', () => {
      const contact = biz.contacts.update(contactId, { title: 'CEO' });
      expect(contact!.title).toBe('CEO');
    });

    test('should list contacts', () => {
      const result = biz.contacts.list(workspaceId);
      expect(result.data.length).toBeGreaterThan(0);
    });

    test('should search contacts', () => {
      const results = biz.contacts.search(workspaceId, 'John');
      expect(results.length).toBeGreaterThan(0);
    });

    test('should add note to contact', () => {
      const note = biz.contacts.addNote(contactId, {
        authorId: 'user-1',
        content: 'First meeting went well',
      });
      expect(note.content).toBe('First meeting went well');
    });

    test('should get contact stats', () => {
      const stats = biz.contacts.getStats(workspaceId);
      expect(stats.total).toBeGreaterThan(0);
    });
  });

  describe('Pipeline & Deals', () => {
    let workspaceId: string;
    let pipelineId: string;
    let dealId: string;

    beforeAll(() => {
      const org = biz.orgs.listForUser('user-1')[0];
      workspaceId = biz.db.prepare(
        'SELECT id FROM biz_workspaces WHERE org_id = ? LIMIT 1'
      ).get(org!.id)?.id as string;
    });

    test('should create default pipeline', () => {
      const pipeline = biz.pipelines.getOrCreateDefault(workspaceId);
      pipelineId = pipeline.id;
      expect(pipeline.stages.length).toBeGreaterThan(0);
      expect(pipeline.isDefault).toBe(true);
    });

    test('should create a deal', () => {
      const deal = biz.pipelines.createDeal(workspaceId, {
        pipelineId,
        title: 'Big Deal',
        value: 50000,
      });
      dealId = deal.id;
      expect(deal.title).toBe('Big Deal');
      expect(deal.value).toBe(50000);
    });

    test('should move deal to new stage', () => {
      const deal = biz.pipelines.moveDeal(dealId, 'qualified');
      expect(deal!.stageId).toBe('qualified');
    });

    test('should get pipeline stats', () => {
      const stats = biz.pipelines.getStats(workspaceId);
      expect(stats.totalDeals).toBeGreaterThan(0);
    });
  });

  describe('Support Tickets', () => {
    let workspaceId: string;

    beforeAll(() => {
      const org = biz.orgs.listForUser('user-1')[0];
      workspaceId = biz.db.prepare(
        'SELECT id FROM biz_workspaces WHERE org_id = ? LIMIT 1'
      ).get(org!.id)?.id as string;
    });

    test('should create a ticket', async () => {
      const ticket = await biz.support.createTicket(workspaceId, {
        subject: 'Help with setup',
        description: 'I need help setting up my account',
        priority: 'high',
      });
      expect(ticket.subject).toBe('Help with setup');
      expect(ticket.number).toBe(1);
    });

    test('should list tickets', () => {
      const result = biz.support.listTickets(workspaceId);
      expect(result.data.length).toBeGreaterThan(0);
    });

    test('should get support stats', () => {
      const stats = biz.support.getStats(workspaceId);
      expect(stats.total).toBeGreaterThan(0);
    });
  });

  describe('Projects & Tasks', () => {
    let workspaceId: string;
    let projectId: string;

    beforeAll(() => {
      const org = biz.orgs.listForUser('user-1')[0];
      workspaceId = biz.db.prepare(
        'SELECT id FROM biz_workspaces WHERE org_id = ? LIMIT 1'
      ).get(org!.id)?.id as string;
    });

    test('should create a project', async () => {
      const project = await biz.projects.createProject(workspaceId, {
        name: 'Website Redesign',
        ownerId: 'user-1',
      });
      projectId = project.id;
      expect(project.name).toBe('Website Redesign');
    });

    test('should create a task', async () => {
      const task = await biz.projects.createTask(workspaceId, {
        projectId,
        title: 'Design homepage',
        priority: 'high',
      });
      expect(task.title).toBe('Design homepage');
    });

    test('should list tasks', () => {
      const result = biz.projects.listTasks(workspaceId);
      expect(result.data.length).toBeGreaterThan(0);
    });
  });

  describe('Finance', () => {
    let workspaceId: string;

    beforeAll(() => {
      const org = biz.orgs.listForUser('user-1')[0];
      workspaceId = biz.db.prepare(
        'SELECT id FROM biz_workspaces WHERE org_id = ? LIMIT 1'
      ).get(org!.id)?.id as string;
    });

    test('should create an invoice', async () => {
      const contact = biz.contacts.create(workspaceId, { type: 'person', name: 'Test Client' });
      const invoice = await biz.finance.createInvoice(workspaceId, {
        contactId: contact.id,
        lineItems: [{ description: 'Consulting', quantity: 10, unitPrice: 150 }],
      });
      expect(invoice.number).toMatch(/^INV-/);
      expect(invoice.total).toBe(1500);
    });
  });

  describe('AI Workers', () => {
    let workspaceId: string;

    beforeAll(() => {
      const org = biz.orgs.listForUser('user-1')[0];
      workspaceId = biz.db.prepare(
        'SELECT id FROM biz_workspaces WHERE org_id = ? LIMIT 1'
      ).get(org!.id)?.id as string;
    });

    test('should deploy all default workers', () => {
      const workers = biz.deployAllWorkers(workspaceId);
      expect(workers.length).toBe(11);
    });

    test('should list workers', () => {
      const workers = biz.workers.listWorkers(workspaceId);
      expect(workers.length).toBe(11);
    });

    test('should have correct worker roles', () => {
      const workers = biz.workers.listWorkers(workspaceId);
      const roles = workers.map(w => w.role);
      expect(roles).toContain('ceo_advisor');
      expect(roles).toContain('sales_director');
      expect(roles).toContain('marketing_director');
      expect(roles).toContain('financial_analyst');
      expect(roles).toContain('hr_manager');
      expect(roles).toContain('project_manager');
      expect(roles).toContain('support_manager');
      expect(roles).toContain('operations_manager');
      expect(roles).toContain('legal_assistant');
      expect(roles).toContain('research_analyst');
      expect(roles).toContain('growth_strategist');
    });
  });

  describe('Integrations', () => {
    test('should list all available connectors', () => {
      const connectors = biz.connectors.list();
      expect(connectors.length).toBeGreaterThan(20);
    });

    test('should have all required categories', () => {
      const categories = biz.connectors.categories();
      expect(categories).toContain('communication');
      expect(categories).toContain('calendar');
      expect(categories).toContain('development');
      expect(categories).toContain('storage');
      expect(categories).toContain('crm_erp');
      expect(categories).toContain('payments');
      expect(categories).toContain('analytics');
    });

    test('should get connector by ID', () => {
      const gmail = biz.connectors.get('gmail');
      expect(gmail).not.toBeNull();
      expect(gmail!.name).toBe('Gmail');
      expect(gmail!.authType).toBe('oauth2');
    });
  });

  describe('Security', () => {
    test('should list security policies', () => {
      const policies = biz.security.listPolicies();
      expect(policies.length).toBeGreaterThan(0);
    });

    test('should enforce least privilege', () => {
      const policies = biz.security.listPolicies();
      const lp = policies.find(p => p.id === 'least_privilege');
      expect(lp).not.toBeNull();
      expect(lp!.enabled).toBe(true);
    });

    test('should enforce workspace isolation', () => {
      const policies = biz.security.listPolicies();
      const di = policies.find(p => p.id === 'data_isolation');
      expect(di).not.toBeNull();
      expect(di!.enabled).toBe(true);
    });
  });

  describe('Audit Trail', () => {
    test('should log audit entries', () => {
      const entry = biz.audit.log({
        orgId: 'test-org',
        actorId: 'user-1',
        actorType: 'member',
        action: 'create',
        resource: 'contacts',
        resourceId: 'contact-1',
      });
      expect(entry.hash).toBeDefined();
      expect(entry.hash.length).toBe(64); // SHA-256 hex
    });

    test('should verify audit chain', () => {
      const result = biz.audit.verify('test-org');
      expect(result.valid).toBe(true);
    });
  });
});
