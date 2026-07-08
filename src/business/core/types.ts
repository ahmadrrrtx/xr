/**
 * XR Business OS — Core Type Definitions
 * 
 * Stage 15: Business OS
 * All types extend XR's existing type system.
 * No duplicate type definitions for Provider, Memory, Skill, Plugin, or MCP.
 */

// ============================================================
// ORGANIZATION & WORKSPACE
// ============================================================

export type OrgRole = 'owner' | 'admin' | 'manager' | 'member' | 'viewer' | 'guest';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  domain?: string;
  logo?: string;
  plan: 'free' | 'starter' | 'business' | 'enterprise';
  settings: OrgSettings;
  createdAt: string;
  updatedAt: string;
}

export interface OrgSettings {
  defaultCurrency: string;
  timezone: string;
  dateFormat: string;
  language: string;
  fiscalYearStart: number; // month (1-12)
  auditRetentionDays: number;
  maxWorkspaces: number;
  maxMembers: number;
  allowedIntegrations: string[]; // empty = all allowed
  blockedIntegrations: string[];
}

export interface Workspace {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  color?: string;
  settings: WorkspaceSettings;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSettings {
  defaultCurrency: string;
  timezone: string;
  modules: string[]; // enabled module IDs
  integrations: WorkspaceIntegration[];
  aiWorkersEnabled: boolean;
  automationEnabled: boolean;
}

export interface WorkspaceIntegration {
  connectorId: string;
  enabled: boolean;
  config: Record<string, unknown>;
  credentialRef: string; // reference to credential vault
  connectedAt?: string;
  lastSyncAt?: string;
}

// ============================================================
// MEMBERS & ROLES
// ============================================================

export interface Member {
  id: string;
  orgId: string;
  userId: string;
  email: string;
  name: string;
  avatar?: string;
  role: OrgRole;
  workspaces: MemberWorkspaceAccess[];
  permissions: Permission[];
  status: 'active' | 'invited' | 'disabled';
  lastActiveAt?: string;
  createdAt: string;
}

export interface MemberWorkspaceAccess {
  workspaceId: string;
  role: OrgRole;
  modules: string[]; // specific module access (empty = all)
}

export interface Permission {
  resource: string; // e.g., 'contacts', 'deals', 'invoices'
  actions: PermissionAction[];
  conditions?: PermissionCondition[];
}

export type PermissionAction = 'create' | 'read' | 'update' | 'delete' | 'export' | 'share' | 'admin';

export interface PermissionCondition {
  field: string;
  operator: 'eq' | 'neq' | 'in' | 'not_in' | 'contains';
  value: unknown;
}

// ============================================================
// CONTACTS (CRM Foundation)
// ============================================================

export type ContactType = 'person' | 'company';

export type ContactStatus = 'lead' | 'prospect' | 'customer' | 'churned' | 'partner' | 'vendor';

export interface Contact {
  id: string;
  workspaceId: string;
  type: ContactType;
  status: ContactStatus;
  name: string;
  email?: string;
  phone?: string;
  avatar?: string;
  company?: string;
  title?: string;
  tags: string[];
  customFields: Record<string, unknown>;
  source?: string; // lead source
  ownerId?: string; // assigned member
  score?: number; // lead score 0-100
  lastContactedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContactNote {
  id: string;
  contactId: string;
  authorId: string;
  content: string;
  type: 'note' | 'email' | 'call' | 'meeting' | 'task';
  createdAt: string;
}

export interface ContactActivity {
  id: string;
  contactId: string;
  type: string;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  actorId: string; // member or worker ID
  timestamp: string;
}

// ============================================================
// PIPELINE (Sales Foundation)
// ============================================================

export type DealStage = 'lead' | 'qualified' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost';

export interface Pipeline {
  id: string;
  workspaceId: string;
  name: string;
  stages: PipelineStage[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineStage {
  id: string;
  name: string;
  order: number;
  probability: number; // 0-100
  color?: string;
  requiredFields?: string[];
}

export interface Deal {
  id: string;
  workspaceId: string;
  pipelineId: string;
  stageId: string;
  title: string;
  value: number;
  currency: string;
  contactId?: string;
  companyId?: string;
  ownerId?: string;
  probability: number;
  expectedCloseDate?: string;
  actualCloseDate?: string;
  tags: string[];
  customFields: Record<string, unknown>;
  lostReason?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// PROJECTS & TASKS
// ============================================================

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low' | 'none';

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  status: 'planning' | 'active' | 'on_hold' | 'completed' | 'archived';
  visibility: 'private' | 'team' | 'public';
  ownerId: string;
  members: ProjectMember[];
  startDate?: string;
  endDate?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMember {
  memberId: string;
  role: 'lead' | 'contributor' | 'viewer';
}

export interface Task {
  id: string;
  workspaceId: string;
  projectId?: string;
  parentId?: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId?: string;
  reporterId?: string;
  dueDate?: string;
  estimatedHours?: number;
  loggedHours?: number;
  tags: string[];
  dependencies: string[]; // task IDs
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
}

export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  dueDate: string;
  status: 'pending' | 'achieved' | 'missed';
  taskIds: string[];
  createdAt: string;
}

// ============================================================
// SUPPORT TICKETS
// ============================================================

export type TicketStatus = 'new' | 'open' | 'pending' | 'on_hold' | 'solved' | 'closed';
export type TicketPriority = 'urgent' | 'high' | 'normal' | 'low';

export interface Ticket {
  id: string;
  workspaceId: string;
  number: number;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  contactId?: string;
  assigneeId?: string;
  tags: string[];
  channel: 'email' | 'chat' | 'phone' | 'web' | 'api';
  sla?: SLAPolicy;
  firstResponseAt?: string;
  resolvedAt?: string;
  satisfaction?: number; // 1-5
  createdAt: string;
  updatedAt: string;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  authorId: string;
  authorType: 'member' | 'contact' | 'worker';
  content: string;
  isInternal: boolean;
  attachments: Attachment[];
  createdAt: string;
}

export interface SLAPolicy {
  firstResponseMinutes: number;
  resolutionMinutes: number;
  businessHoursOnly: boolean;
}

// ============================================================
// KNOWLEDGE BASE
// ============================================================

export interface KnowledgeArticle {
  id: string;
  workspaceId: string;
  title: string;
  slug: string;
  content: string; // markdown
  category?: string;
  tags: string[];
  status: 'draft' | 'published' | 'archived';
  visibility: 'internal' | 'public';
  authorId: string;
  viewCount: number;
  helpfulCount: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// FINANCE
// ============================================================

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled' | 'refunded';

export interface Invoice {
  id: string;
  workspaceId: string;
  number: string;
  contactId: string;
  dealId?: string;
  status: InvoiceStatus;
  currency: string;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  tax: number;
  total: number;
  issuedAt?: string;
  dueAt?: string;
  paidAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxRate?: number;
}

export interface Expense {
  id: string;
  workspaceId: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  date: string;
  receiptUrl?: string;
  memberId?: string;
  status: 'pending' | 'approved' | 'rejected' | 'reimbursed';
  createdAt: string;
}

// ============================================================
// HR
// ============================================================

export type TimeOffType = 'vacation' | 'sick' | 'personal' | 'parental' | 'unpaid';

export interface Employee {
  id: string;
  workspaceId: string;
  memberId: string;
  department?: string;
  position?: string;
  startDate?: string;
  endDate?: string;
  salary?: number;
  currency?: string;
  status: 'active' | 'on_leave' | 'terminated';
  customFields: Record<string, unknown>;
  createdAt: string;
}

export interface TimeOffRequest {
  id: string;
  employeeId: string;
  type: TimeOffType;
  startDate: string;
  endDate: string;
  days: number;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  createdAt: string;
}

// ============================================================
// MEETINGS & CALENDAR
// ============================================================

export interface Meeting {
  id: string;
  workspaceId: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  timezone: string;
  location?: string;
  meetingUrl?: string;
  organizerId: string;
  attendees: MeetingAttendee[];
  agenda?: string;
  notes?: string;
  transcript?: string;
  recordingUrl?: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  relatedTo?: { type: string; id: string }; // contact, deal, project
  createdAt: string;
  updatedAt: string;
}

export interface MeetingAttendee {
  memberId?: string;
  contactId?: string;
  email: string;
  name: string;
  response: 'accepted' | 'declined' | 'tentative' | 'pending';
}

export interface CalendarEvent {
  id: string;
  workspaceId: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  timezone: string;
  recurrence?: string; // iCal RRULE
  color?: string;
  visibility: 'default' | 'public' | 'private';
  source: 'local' | 'google' | 'outlook' | 'cal_com';
  externalId?: string;
  memberId: string;
  createdAt: string;
}

// ============================================================
// DOCUMENTS
// ============================================================

export interface Document {
  id: string;
  workspaceId: string;
  title: string;
  content: string; // markdown
  templateId?: string;
  folderId?: string;
  ownerId: string;
  collaborators: DocumentCollaborator[];
  version: number;
  status: 'draft' | 'review' | 'approved' | 'published';
  tags: string[];
  relatedTo?: { type: string; id: string };
  createdAt: string;
  updatedAt: string;
}

export interface DocumentCollaborator {
  memberId: string;
  role: 'editor' | 'commenter' | 'viewer';
}

export interface DocumentTemplate {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  content: string;
  category: string;
  variables: TemplateVariable[];
  createdAt: string;
}

export interface TemplateVariable {
  name: string;
  type: 'text' | 'number' | 'date' | 'select' | 'contact' | 'deal';
  label: string;
  required: boolean;
  defaultValue?: string;
  options?: string[];
}

// ============================================================
// AUTOMATION
// ============================================================

export type TriggerType = 'event' | 'schedule' | 'webhook' | 'manual';
export type ActionType = 'create_record' | 'update_record' | 'send_email' | 'send_notification' |
  'run_worker' | 'call_api' | 'run_skill' | 'conditional' | 'delay' | 'transform';

export interface Automation {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  steps: AutomationStep[];
  executionCount: number;
  lastExecutedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationTrigger {
  type: TriggerType;
  config: AutomationTriggerConfig;
}

export interface AutomationTriggerConfig {
  // Event trigger
  event?: string; // e.g., 'deal.created', 'ticket.created'
  filters?: Record<string, unknown>;
  // Schedule trigger
  cron?: string;
  timezone?: string;
  // Webhook trigger
  webhookPath?: string;
  webhookSecret?: string;
}

export interface AutomationStep {
  id: string;
  name?: string;
  type: ActionType;
  config: Record<string, unknown>;
  conditions?: AutomationCondition[];
  onError: 'stop' | 'skip' | 'retry';
  retryCount?: number;
}

export interface AutomationCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'starts_with' | 'ends_with' | 'in' | 'is_empty' | 'is_not_empty';
  value: unknown;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  steps: AutomationStepRun[];
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface AutomationStepRun {
  stepId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  input?: unknown;
  output?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

// ============================================================
// AI WORKERS
// ============================================================

export type WorkerRole = 'ceo_advisor' | 'sales_director' | 'marketing_director' |
  'financial_analyst' | 'hr_manager' | 'project_manager' | 'support_manager' |
  'operations_manager' | 'legal_assistant' | 'research_analyst' | 'growth_strategist';

export interface AIWorker {
  id: string;
  workspaceId: string;
  role: WorkerRole;
  name: string;
  description: string;
  systemPrompt: string;
  enabled: boolean;
  avatar?: string;
  capabilities: WorkerCapability[];
  permissions: Permission[];
  model?: string; // override provider model
  memoryEnabled: boolean;
  researchEnabled: boolean;
  voiceEnabled: boolean;
  computerControlEnabled: boolean;
  schedule?: string; // cron for proactive actions
  lastActiveAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerCapability {
  module: string; // e.g., 'crm', 'sales', 'finance'
  actions: string[]; // e.g., ['read_contacts', 'create_deal']
}

export interface WorkerConversation {
  id: string;
  workerId: string;
  memberId: string;
  messages: WorkerMessage[];
  context: WorkerContext;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerMessage {
  id: string;
  role: 'user' | 'worker' | 'system';
  content: string;
  toolCalls?: WorkerToolCall[];
  timestamp: string;
}

export interface WorkerToolCall {
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export interface WorkerContext {
  recentContacts?: Contact[];
  recentDeals?: Deal[];
  recentTickets?: Ticket[];
  recentTasks?: Task[];
  recentDocuments?: Document[];
  kpis?: Record<string, number>;
}

// ============================================================
// ANALYTICS
// ============================================================

export interface Dashboard {
  id: string;
  workspaceId: string;
  name: string;
  widgets: DashboardWidget[];
  layout: DashboardLayout;
  visibility: 'private' | 'team' | 'public';
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardWidget {
  id: string;
  type: 'metric' | 'chart' | 'table' | 'list' | 'funnel' | 'pipeline' | 'activity';
  title: string;
  config: WidgetConfig;
  position: { x: number; y: number; w: number; h: number };
}

export interface WidgetConfig {
  dataSource: string; // module.entity or custom query
  metric?: string;
  dimensions?: string[];
  filters?: Record<string, unknown>;
  chartType?: 'line' | 'bar' | 'pie' | 'donut' | 'area' | 'scatter';
  dateRange?: string;
  groupBy?: string;
  sortBy?: string;
  limit?: number;
}

export interface DashboardLayout {
  columns: number;
  rowHeight: number;
  gap: number;
}

export interface Report {
  id: string;
  workspaceId: string;
  name: string;
  type: 'sales' | 'support' | 'project' | 'finance' | 'hr' | 'custom';
  config: ReportConfig;
  schedule?: string; // cron for auto-generation
  lastGeneratedAt?: string;
  format: 'pdf' | 'csv' | 'json';
  createdAt: string;
}

export interface ReportConfig {
  metrics: string[];
  dimensions: string[];
  filters: Record<string, unknown>;
  dateRange: { start: string; end: string };
  groupBy?: string;
  sortBy?: string;
  limit?: number;
}

// ============================================================
// ATTACHMENTS & SHARED
// ============================================================

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  storageType: 'local' | 's3' | 'gcs' | 'azure';
  createdAt: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface FilterParams {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'starts_with' | 'ends_with' | 'in' | 'between';
  value: unknown;
}

export interface SearchResult {
  entity: string;
  id: string;
  title: string;
  subtitle?: string;
  url?: string;
  score: number;
  highlights?: Record<string, string[]>;
}

// ============================================================
// AUDIT & EVENTS
// ============================================================

export interface AuditEntry {
  id: string;
  orgId: string;
  workspaceId?: string;
  actorId: string;
  actorType: 'member' | 'worker' | 'system' | 'api';
  action: string;
  resource: string;
  resourceId: string;
  changes?: Record<string, { before: unknown; after: unknown }>;
  metadata?: Record<string, unknown>;
  hash: string; // SHA-256 chain
  previousHash?: string;
  timestamp: string;
}

export interface BusinessEvent {
  id: string;
  workspaceId: string;
  type: string; // e.g., 'deal.created', 'ticket.resolved'
  source: string; // module ID
  data: Record<string, unknown>;
  actorId?: string;
  timestamp: string;
}

// ============================================================
// CLI COMMAND TYPES
// ============================================================

export interface BizCommandContext {
  orgId: string;
  workspaceId?: string;
  memberId: string;
  role: OrgRole;
}
