/**
 * XR 5.3 — Personal and Business Operating Layer — Operating Types
 * Canonical contracts for outcomes, record mutations, worker governance,
 * artifacts/evidence, approvals, privacy, journeys.
 *
 * No Phase 11+ remote control plane.
 */

import type { WorkerRole } from './types.ts';

// ── Outcome Contract ────────────────────────────────────────────────────

export type OutcomeCategory =
  | 'personal_knowledge'
  | 'developer_project'
  | 'research_evidence'
  | 'customer_crm'
  | 'sales_followup'
  | 'projects_meetings_docs'
  | 'scheduling_communication'
  | 'finance_operations';

export type OutcomeStatus = 'pending' | 'verified' | 'partial' | 'failed' | 'reverted';

export interface OutcomeMetric {
  name: string;
  value: number | string;
  unit?: string;
  target?: number;
}

export interface VerifiedOutcome {
  outcomeId: string;
  journeyId: string;
  journeyCategory: OutcomeCategory;
  workflowRunId: string;
  workspaceId: string;
  orgId: string;
  status: OutcomeStatus;
  title: string;
  summary: string;
  recordsChanged: Array<{ module: string; entity: string; id: string; operation: string }>;
  artifacts: string[]; // artifactIds
  evidenceRefs: string[];
  metrics: OutcomeMetric[];
  cost: { estimatedUsd: number; actualUsd: number; tokensIn: number; tokensOut: number; durationMs: number };
  verifiedAt?: string;
  verifiedBy?: string;
  failureReason?: string;
  reversibility: { reversible: boolean; restorePath?: Record<string, unknown> };
  createdAt: string;
  updatedAt: string;
}

// ── Record Mutation Authority Contract ──────────────────────────────────

export type RecordMutationOperation = 'create' | 'update' | 'delete';
export type MutationActorKind = 'user' | 'worker' | 'system' | 'automation';
export type MutationSourceKind = 'user_input' | 'workflow' | 'automation' | 'integration' | 'worker_proposal' | 'api';

export interface EvidenceRef {
  kind: 'context_item' | 'research_source' | 'document' | 'execution_record' | 'business_record' | 'artifact' | 'meeting' | 'contact' | 'deal';
  id: string;
  hash?: string;
  url?: string;
}

export interface PolicyDecisionRef {
  decision: 'allowed' | 'denied' | 'requires_approval' | 'requires_review';
  reason: string;
  by: string;
  tier?: string;
}

export interface ApprovalRef {
  decisionId: string;
  decidedBy: string;
  outcome: 'approved' | 'denied' | 'changes_requested' | 'rejected' | 'expired';
  comment?: string;
}

export interface BusinessRecordMutation {
  mutationId: string;
  orgId: string;
  workspaceId: string;
  module: string;
  entity: string;
  entityId: string;
  operation: RecordMutationOperation;
  actor: { kind: MutationActorKind; id: string; name?: string };
  workerRef?: string;
  workflowRef?: { definitionId: string; version: number; runId: string; nodeId: string };
  executionRefs: string[];
  policyDecision?: PolicyDecisionRef;
  approvalRef?: ApprovalRef;
  source: { kind: MutationSourceKind; id?: string };
  evidence: EvidenceRef[];
  contextPackageIds: string[];
  previousValue?: Record<string, unknown>;
  changeSet: Record<string, { before: unknown; after: unknown }>;
  timestamp: number;
  version: number;
  reversible: boolean;
  restorePath?: { method: string; data: Record<string, unknown> };
  contentHash: string;
}

export interface MutationProposal {
  orgId: string;
  workspaceId: string;
  module: string;
  entity: string;
  data: Record<string, unknown>;
  operation: RecordMutationOperation;
  actor: { kind: MutationActorKind; id: string; name?: string };
  evidence?: EvidenceRef[];
  contextPackageIds?: string[];
  source: { kind: MutationSourceKind; id?: string };
  executionRef?: string;
  workflowRef?: { definitionId: string; version: number; runId: string; nodeId: string };
}

// ── AI Worker Governance Contract ───────────────────────────────────────

export type RiskTier = 'tier0' | 'tier1' | 'tier2' | 'tier3';
export type PlacementKind = 'in_process' | 'restricted_process' | 'namespace_sandbox' | 'container';
export type NotificationChannel = 'dashboard' | 'cli' | 'webhook' | 'email' | 'telegram';
export interface NotificationRecipient { kind: 'user' | 'role' | 'webhook_url'; id: string }

export interface WorkerAuthorityProfile {
  profileId: string;
  workerId: string;
  role: WorkerRole;
  identity: { workerId: string; name: string; avatar?: string; version: number };
  organization: { orgId: string; workspaceIds: string[]; scope: 'single-workspace' | 'multi-workspace' | 'org-read' };
  allowedWorkflows: string[]; // definitionIds
  contextScope: { tiers: ('instructions' | 'data' | 'quarantine')[]; maxItems: number; allowUserMemory: boolean; allowWorkspaceMemory: boolean; sensitivityMax: 'public' | 'internal' | 'confidential' | 'restricted' };
  capabilities: Array<{ kind: string; name: string; effective: boolean }>;
  toolScope: { mode: 'allowlist' | 'denylist'; tools: string[] };
  providerScope: { allowedProviders: string[]; allowedModels: string[]; routingPolicy: 'local-only' | 'local-first' | 'cost-constrained' | 'manual'; locality: 'local' | 'private' | 'hybrid' };
  budget: { maxUsdPerTask: number; maxUsdPerDay: number; maxTokensPerTask: number; maxStepsPerTask: number; usedUsdToday: number; usedTokensToday: number };
  risk: { maxTier: RiskTier; allowedPlacements: PlacementKind[]; requiresHostAuthority: boolean };
  approval: { autoAllowedActions: string[]; requiresApprovalActions: string[]; requiresReviewActions: string[]; approvalExpiryMs: number };
  dataAccess: { resources: string[]; fieldLevel?: Record<string, string[]>; crossWorkspace: boolean };
  successCriteria: { outcomeMetrics: string[]; evidenceRequired: boolean; humanReviewRequiredFor: string[] };
  escalation: { channels: NotificationChannel[]; severityThreshold: 'info' | 'warning' | 'critical'; groupWindowMs: number; recipients: NotificationRecipient[] };
  revocation: { disableRemovesAuthority: boolean; revokeCredentialsOnDisable: boolean; auditOnDisable: boolean };
  status: { enabled: boolean; disabledReason?: string; disabledAt?: number; lastActiveAt?: number; budgetUsedToday: number };
  createdAt: string;
  updatedAt: string;
}

export interface WorkerInspection {
  workerId: string;
  profile: WorkerAuthorityProfile;
  effectiveAuthority: Record<string, string[]>; // resource -> actions effective
  activeExecutions: number;
  recentOutcomes: VerifiedOutcome[];
  pendingApprovals: number;
  budgetStatus: { remainingUsd: number; remainingTokens: number; pctUsed: number };
  riskStatus: { currentTier: RiskTier; placement: PlacementKind; blocked: boolean };
}

// ── Artifact & Evidence ─────────────────────────────────────────────────

export interface BusinessArtifact {
  artifactId: string;
  workspaceId: string;
  orgId?: string;
  workflowRunId?: string;
  nodeId?: string;
  contract: { kind: 'document' | 'research_report' | 'meeting_notes' | 'communication' | 'analytics' | 'record_snapshot' | 'proposal'; name: string };
  location: string; // file path or inline hash
  contentHash: string;
  provenance: {
    actor: { kind: string; id: string };
    sources: EvidenceRef[];
    contextPackageIds: string[];
    executionRefs: string[];
    workflowRef?: { definitionId: string; runId: string };
    createdAt: number;
  };
  linkedRecords: Array<{ module: string; entity: string; id: string }>;
  sensitivity: 'public' | 'internal' | 'confidential' | 'restricted';
  createdAt: string;
}

// ── Approval & Escalation ───────────────────────────────────────────────

export type ApprovalKind = 'approval' | 'review';
export type ApprovalSeverity = 'info' | 'warning' | 'critical';
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'changes_requested' | 'rejected' | 'expired' | 'cancelled';

export interface ApprovalRequest {
  approvalId: string;
  kind: ApprovalKind;
  orgId: string;
  workspaceId: string;
  workflowRunId?: string;
  nodeId?: string;
  requestedBy: { kind: string; id: string };
  title: string;
  description: string;
  severity: ApprovalSeverity;
  channels: NotificationChannel[];
  recipients: NotificationRecipient[];
  evidence: EvidenceRef[];
  artifacts: string[];
  recordMutationId?: string;
  contextShown: {
    packageIds: string[];
    summary: string;
    uncertainty?: { confidence: number; reasons: string[] };
  };
  status: ApprovalStatus;
  decision?: { decidedBy: string; outcome: ApprovalStatus; comment?: string; decidedAt: string };
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
}

// ── Privacy & Local Operation ────────────────────────────────────────────

export type PrivacyMode = 'local' | 'private' | 'hybrid';
export type DataSensitivity = 'public' | 'internal' | 'confidential' | 'restricted';
export type CloudTransferPolicy = 'allow' | 'require_approval' | 'require_consent' | 'deny';

export interface PrivacyPolicy {
  policyId: string;
  orgId: string;
  workspaceId: string;
  mode: PrivacyMode;
  rules: Array<{
    resource: string;
    sensitivity: DataSensitivity;
    transferPolicy: CloudTransferPolicy;
    allowedProviders?: string[];
    requiresApproval?: boolean;
    maskFields?: string[];
  }>;
  createdAt: string;
  updatedAt: string;
}

// ── Journey Definition ──────────────────────────────────────────────────

export type JourneyTriggerKind = 'manual' | 'intent' | 'event' | 'schedule' | 'webhook' | 'api';

export interface JourneyTriggerSpec {
  kind: JourneyTriggerKind;
  eventType?: string; // e.g. 'deal.created'
  intentPattern?: string;
  schedule?: string;
  webhookPath?: string;
}

export interface JourneyContextSpec {
  tiers: ('instructions' | 'data' | 'quarantine')[];
  includeUserMemory: boolean;
  maxItems: number;
  locality: 'local' | 'private' | 'hybrid';
  sensitivityMax: DataSensitivity;
}

export interface JourneyWorkflowSpec {
  definitionId: string;
  version: number;
  nodes: Array<{ id: string; kind: string; name: string }>; // summary
  capabilities: string[];
  authority: { requiredRole: string; requiresApproval: boolean };
}

export interface JourneyOutcomeSpec {
  metrics: string[];
  verifiedOutcomeType: string;
  costBudget: { maxUsd: number; maxTokens: number; maxDurationMs: number };
  successCriteria: string[];
}

export interface JourneyDefinition {
  id: string;
  name: string;
  category: OutcomeCategory;
  description: string;
  trigger: JourneyTriggerSpec;
  context: JourneyContextSpec;
  workflow: JourneyWorkflowSpec;
  outcomes: JourneyOutcomeSpec;
  artifacts: string[]; // artifact contract kinds produced
  privacy: PrivacyMode;
  version: number;
  active: boolean;
  createdAt: string;
}

// ── Business Operating Layer Status ─────────────────────────────────────

export interface OperatingLayerStatus {
  version: string;
  journeys: number;
  activeWorkflows: number;
  pendingApprovals: number;
  workers: { total: number; enabled: number; disabled: number };
  outcomes: { total: number; verified: number; failed: number };
  artifacts: number;
  privacyMode: PrivacyMode;
  localOnly: boolean;
}
