/**
 * XR Business OS — SQLite Schema
 * 
 * Uses existing XR SQLite database. Adds business tables.
 * All tables prefixed with `biz_` to avoid conflicts.
 */

export const BUSINESS_SCHEMA_VERSION = 1;

export const BUSINESS_TABLES = `
-- Organizations (top-level tenant)
CREATE TABLE IF NOT EXISTS biz_organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  domain TEXT,
  logo TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Workspaces
CREATE TABLE IF NOT EXISTS biz_workspaces (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES biz_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  color TEXT,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(org_id, slug)
);

-- Members
CREATE TABLE IF NOT EXISTS biz_members (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES biz_organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  workspaces TEXT NOT NULL DEFAULT '[]',
  permissions TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  last_active_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(org_id, user_id)
);

-- Contacts (CRM)
CREATE TABLE IF NOT EXISTS biz_contacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES biz_workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'person',
  status TEXT NOT NULL DEFAULT 'lead',
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  avatar TEXT,
  company TEXT,
  title TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  source TEXT,
  owner_id TEXT,
  score INTEGER,
  last_contacted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_biz_contacts_workspace ON biz_contacts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_biz_contacts_email ON biz_contacts(email);
CREATE INDEX IF NOT EXISTS idx_biz_contacts_status ON biz_contacts(status);

-- Contact Notes & Activities
CREATE TABLE IF NOT EXISTS biz_contact_notes (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES biz_contacts(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'note',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS biz_contact_activities (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES biz_contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  metadata TEXT DEFAULT '{}',
  actor_id TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pipelines
CREATE TABLE IF NOT EXISTS biz_pipelines (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES biz_workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  stages TEXT NOT NULL DEFAULT '[]',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Deals
CREATE TABLE IF NOT EXISTS biz_deals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES biz_workspaces(id) ON DELETE CASCADE,
  pipeline_id TEXT NOT NULL REFERENCES biz_pipelines(id),
  stage_id TEXT NOT NULL,
  title TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  contact_id TEXT,
  company_id TEXT,
  owner_id TEXT,
  probability INTEGER NOT NULL DEFAULT 0,
  expected_close_date TEXT,
  actual_close_date TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  lost_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_biz_deals_workspace ON biz_deals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_biz_deals_stage ON biz_deals(stage_id);
CREATE INDEX IF NOT EXISTS idx_biz_deals_contact ON biz_deals(contact_id);

-- Projects
CREATE TABLE IF NOT EXISTS biz_projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES biz_workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planning',
  visibility TEXT NOT NULL DEFAULT 'team',
  owner_id TEXT NOT NULL,
  members TEXT NOT NULL DEFAULT '[]',
  start_date TEXT,
  end_date TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tasks
CREATE TABLE IF NOT EXISTS biz_tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES biz_workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES biz_projects(id) ON DELETE SET NULL,
  parent_id TEXT REFERENCES biz_tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'medium',
  assignee_id TEXT,
  reporter_id TEXT,
  due_date TEXT,
  estimated_hours REAL,
  logged_hours REAL,
  tags TEXT NOT NULL DEFAULT '[]',
  dependencies TEXT NOT NULL DEFAULT '[]',
  attachments TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_biz_tasks_workspace ON biz_tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_biz_tasks_project ON biz_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_biz_tasks_status ON biz_tasks(status);
CREATE INDEX IF NOT EXISTS idx_biz_tasks_assignee ON biz_tasks(assignee_id);

-- Milestones
CREATE TABLE IF NOT EXISTS biz_milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES biz_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  task_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Support Tickets
CREATE TABLE IF NOT EXISTS biz_tickets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES biz_workspaces(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  priority TEXT NOT NULL DEFAULT 'normal',
  contact_id TEXT,
  assignee_id TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  channel TEXT NOT NULL DEFAULT 'web',
  sla TEXT,
  first_response_at TEXT,
  resolved_at TEXT,
  satisfaction INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_biz_tickets_workspace ON biz_tickets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_biz_tickets_status ON biz_tickets(status);
CREATE INDEX IF NOT EXISTS idx_biz_tickets_contact ON biz_tickets(contact_id);

-- Ticket Messages
CREATE TABLE IF NOT EXISTS biz_ticket_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES biz_tickets(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  author_type TEXT NOT NULL DEFAULT 'member',
  content TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,
  attachments TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Knowledge Articles
CREATE TABLE IF NOT EXISTS biz_knowledge_articles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES biz_workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  visibility TEXT NOT NULL DEFAULT 'internal',
  author_id TEXT NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 0,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Invoices
CREATE TABLE IF NOT EXISTS biz_invoices (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES biz_workspaces(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  deal_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  currency TEXT NOT NULL DEFAULT 'USD',
  line_items TEXT NOT NULL DEFAULT '[]',
  subtotal REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  issued_at TEXT,
  due_at TEXT,
  paid_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Expenses
CREATE TABLE IF NOT EXISTS biz_expenses (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES biz_workspaces(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  date TEXT NOT NULL,
  receipt_url TEXT,
  member_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Employees (HR)
CREATE TABLE IF NOT EXISTS biz_employees (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES biz_workspaces(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  department TEXT,
  position TEXT,
  start_date TEXT,
  end_date TEXT,
  salary REAL,
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Time Off Requests
CREATE TABLE IF NOT EXISTS biz_time_off (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES biz_employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days REAL NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Meetings
CREATE TABLE IF NOT EXISTS biz_meetings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES biz_workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  location TEXT,
  meeting_url TEXT,
  organizer_id TEXT NOT NULL,
  attendees TEXT NOT NULL DEFAULT '[]',
  agenda TEXT,
  notes TEXT,
  transcript TEXT,
  recording_url TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  related_to TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Calendar Events
CREATE TABLE IF NOT EXISTS biz_calendar_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES biz_workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  recurrence TEXT,
  color TEXT,
  visibility TEXT NOT NULL DEFAULT 'default',
  source TEXT NOT NULL DEFAULT 'local',
  external_id TEXT,
  member_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Documents
CREATE TABLE IF NOT EXISTS biz_documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES biz_workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  template_id TEXT,
  folder_id TEXT,
  owner_id TEXT NOT NULL,
  collaborators TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  tags TEXT NOT NULL DEFAULT '[]',
  related_to TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Document Templates
CREATE TABLE IF NOT EXISTS biz_document_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES biz_workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  variables TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Automations
CREATE TABLE IF NOT EXISTS biz_automations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES biz_workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  trigger TEXT NOT NULL,
  steps TEXT NOT NULL DEFAULT '[]',
  execution_count INTEGER NOT NULL DEFAULT 0,
  last_executed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Automation Runs
CREATE TABLE IF NOT EXISTS biz_automation_runs (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL REFERENCES biz_automations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',
  steps TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  error TEXT
);

-- AI Workers
CREATE TABLE IF NOT EXISTS biz_workers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES biz_workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  avatar TEXT,
  capabilities TEXT NOT NULL DEFAULT '[]',
  permissions TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  memory_enabled INTEGER NOT NULL DEFAULT 1,
  research_enabled INTEGER NOT NULL DEFAULT 1,
  voice_enabled INTEGER NOT NULL DEFAULT 0,
  computer_control_enabled INTEGER NOT NULL DEFAULT 0,
  schedule TEXT,
  last_active_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Worker Conversations
CREATE TABLE IF NOT EXISTS biz_worker_conversations (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES biz_workers(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  messages TEXT NOT NULL DEFAULT '[]',
  context TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dashboards
CREATE TABLE IF NOT EXISTS biz_dashboards (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES biz_workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  widgets TEXT NOT NULL DEFAULT '[]',
  layout TEXT NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'private',
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Reports
CREATE TABLE IF NOT EXISTS biz_reports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES biz_workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config TEXT NOT NULL,
  schedule TEXT,
  last_generated_at TEXT,
  format TEXT NOT NULL DEFAULT 'pdf',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Audit Trail
CREATE TABLE IF NOT EXISTS biz_audit (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  workspace_id TEXT,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'member',
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  changes TEXT,
  metadata TEXT,
  hash TEXT NOT NULL,
  previous_hash TEXT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_biz_audit_org ON biz_audit(org_id);
CREATE INDEX IF NOT EXISTS idx_biz_audit_resource ON biz_audit(resource, resource_id);
CREATE INDEX IF NOT EXISTS idx_biz_audit_timestamp ON biz_audit(timestamp);

-- Business Events
CREATE TABLE IF NOT EXISTS biz_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES biz_workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  actor_id TEXT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_biz_events_workspace ON biz_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_biz_events_type ON biz_events(type);

-- Integration Credentials (BYOK Vault)
CREATE TABLE IF NOT EXISTS biz_credentials (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES biz_organizations(id) ON DELETE CASCADE,
  connector_id TEXT NOT NULL,
  name TEXT NOT NULL,
  credentials TEXT NOT NULL, -- encrypted
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Integration Sync State
CREATE TABLE IF NOT EXISTS biz_integration_sync (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES biz_workspaces(id) ON DELETE CASCADE,
  connector_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  last_sync_at TEXT,
  last_cursor TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  error TEXT,
  UNIQUE(workspace_id, connector_id, resource)
);

-- Schema Version
CREATE TABLE IF NOT EXISTS biz_schema_version (
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export const BUSINESS_TABLE_NAMES = [
  'biz_organizations',
  'biz_workspaces',
  'biz_members',
  'biz_contacts',
  'biz_contact_notes',
  'biz_contact_activities',
  'biz_pipelines',
  'biz_deals',
  'biz_projects',
  'biz_tasks',
  'biz_milestones',
  'biz_tickets',
  'biz_ticket_messages',
  'biz_knowledge_articles',
  'biz_invoices',
  'biz_expenses',
  'biz_employees',
  'biz_time_off',
  'biz_meetings',
  'biz_calendar_events',
  'biz_documents',
  'biz_document_templates',
  'biz_automations',
  'biz_automation_runs',
  'biz_workers',
  'biz_worker_conversations',
  'biz_dashboards',
  'biz_reports',
  'biz_audit',
  'biz_events',
  'biz_credentials',
  'biz_integration_sync',
  'biz_schema_version',
] as const;
