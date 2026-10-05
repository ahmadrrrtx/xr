/*
 * Shield / Trust Center types (Phase 12, SCREEN 8).
 *
 * Pure shapes shared by the store, the screen, the Rust mirror
 * (src-tauri/src/shield/mod.rs — camelCase on the wire) and the unit tests.
 * Vocabulary follows ADR-0027 ("XR Shield" = the enforcement boundary) and
 * the CLI's audit evidence: entries are SHA-256 hash-chained (tamper-
 * evident); Ed25519 checkpoint signatures are a later phase, so `signature`
 * is always null here and the UI never says "signed".
 */
import type { ApprovalRequest, ApprovalRisk } from '@/lib/approvalCore';

// ─── Status ────────────────────────────────────────────────────────────────

/**
 * `unknown` = no health check has completed yet (fresh install / loading).
 * It is never rendered as green: a green check must be backed by a check
 * that ran (Constitution Art. IV.2).
 */
export type ShieldState = 'protected' | 'attention' | 'compromised' | 'unknown';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'planned';

export type CheckId =
  | 'audit_db'
  | 'approval_queue'
  | 'keychain'
  | 'audit_chain'
  | 'settings_store'
  | 'egress_proxy'
  | 'biometric'
  | 'pii_redaction'
  | 'version_integrity';

export const CHECK_IDS: readonly CheckId[] = [
  'audit_db',
  'approval_queue',
  'keychain',
  'audit_chain',
  'settings_store',
  'egress_proxy',
  'biometric',
  'pii_redaction',
  'version_integrity',
];

/** Checks 1–5 are integrity-critical: a `fail` there means compromised. */
export const CRITICAL_CHECKS: ReadonlySet<CheckId> = new Set<CheckId>([
  'audit_db',
  'approval_queue',
  'keychain',
  'audit_chain',
  'settings_store',
]);

export const CHECK_LABEL: Record<CheckId, string> = {
  audit_db: 'Audit database',
  approval_queue: 'Approval queue',
  keychain: 'Secrets store',
  audit_chain: 'Audit chain',
  settings_store: 'Settings store',
  egress_proxy: 'Egress proxy',
  biometric: 'Biometric approval',
  pii_redaction: 'PII redaction',
  version_integrity: 'Version integrity',
};

export interface HealthCheck {
  id: CheckId;
  label: string;
  status: CheckStatus;
  /** One calm sentence: what was checked and what was found. */
  detail: string;
  critical: boolean;
  durationMs?: number;
}

export interface ShieldStats {
  /** Requests that did not run in the last 24 h (blocked + denied + quarantined). */
  blocked24h: number;
  pendingApprovals: number;
  /** 0–100, or null when nothing was decided in the window. */
  autoApprovedRate30d: number | null;
  quarantinedSkills: number;
}

export interface ShieldStatus {
  state: ShieldState;
  headline: string;
  subtitle: string;
  cta: string;
  checks: HealthCheck[];
  stats: ShieldStats;
  /** ms since epoch of the last completed health check; null before the first. */
  lastCheckedAt: number | null;
  paused: boolean;
}

// ─── Audit ─────────────────────────────────────────────────────────────────

export type AuditDecision =
  'allowed' | 'denied' | 'auto-approved' | 'quarantined' | 'blocked' | 'error';

export const AUDIT_DECISIONS: readonly AuditDecision[] = [
  'allowed',
  'denied',
  'auto-approved',
  'quarantined',
  'blocked',
  'error',
];

export function isAuditDecision(value: unknown): value is AuditDecision {
  return (
    typeof value === 'string' &&
    (AUDIT_DECISIONS as readonly string[]).includes(value)
  );
}

/** Actor is `user`, `system`, or `agent:<name>`. */
export type AuditActorKind = 'user' | 'agent' | 'system';

export interface AuditEntry {
  /** `aud_` + zero-padded sequence (seed) or `aud_` + uuid fragment (live). */
  id: string;
  /** ms since epoch. */
  ts: number;
  actor: string;
  skill: string | null;
  action: string;
  resource: string | null;
  decision: AuditDecision;
  /** Policy / remember rule that decided, when one did. */
  ruleId: string | null;
  risk: ApprovalRisk;
  costUsd: number | null;
  /** Always null in Phase 12 — Ed25519 checkpoint signatures are planned. */
  signature: null;
  /** Hash of the previous entry; null for the genesis entry. */
  prevHash: string | null;
  /** SHA-256 (hex) of this entry's canonical form. */
  hash: string;
  detail: string | null;
}

/** What a writer supplies — ids, timestamps and the chain are added by the log. */
export type AuditInput = Omit<
  AuditEntry,
  'id' | 'ts' | 'signature' | 'prevHash' | 'hash'
> & { ts?: number };

export type AuditRange = '24h' | '7d' | '30d' | 'all';

export const AUDIT_RANGES: readonly AuditRange[] = ['24h', '7d', '30d', 'all'];

export const AUDIT_RANGE_LABEL: Record<AuditRange, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  all: 'All time',
};

export interface AuditFilter {
  search: string;
  decision: AuditDecision | 'all';
  actor: AuditActorKind | 'all';
  range: AuditRange;
}

export const DEFAULT_AUDIT_FILTER: AuditFilter = {
  search: '',
  decision: 'all',
  actor: 'all',
  range: '7d',
};

export type AuditSortColumn = 'ts' | 'costUsd';

export interface AuditSort {
  col: AuditSortColumn;
  dir: 'asc' | 'desc';
}

export const DEFAULT_AUDIT_SORT: AuditSort = { col: 'ts', dir: 'desc' };

export interface ChainVerification {
  valid: boolean;
  checked: number;
  /** Index (chain order) of the first broken link, when invalid. */
  brokenAt: number | null;
  /** Human sentence for the UI/toast. */
  detail: string;
  verifiedAt: number;
}

// ─── Approvals history ─────────────────────────────────────────────────────

export type RememberChoice = 'always' | '1h' | 'once' | 'deny-permanent';

export type DecidedBy =
  'user' | 'auto-rule' | 'auto-timeout' | 'bulk' | 'policy';

export interface ApprovalRecord {
  request: ApprovalRequest;
  decision: 'approved' | 'denied' | 'blocked';
  decidedAt: number;
  remember: RememberChoice | null;
  decidedBy: DecidedBy;
  reason?: string;
  ruleId?: string;
}

// ─── Policy ────────────────────────────────────────────────────────────────

export type Strictness = 'relaxed' | 'balanced' | 'strict';

export interface SecurityPolicy {
  egressProxy: boolean;
  autoApproveLowRisk: boolean;
  constitutionStrictness: Strictness;
  quarantineNewSkills: boolean;
  biometricApproval: boolean;
  allowShellExec: boolean;
  piiRedaction: boolean;
  dataSharing: boolean;
  allowedDomains: string[];
  blockedDomains: string[];
  /** Read-only: whether this build can show an OS biometric prompt. */
  biometricSupported: boolean;
}

export type PolicyToggleKey =
  | 'egressProxy'
  | 'autoApproveLowRisk'
  | 'quarantineNewSkills'
  | 'biometricApproval'
  | 'allowShellExec'
  | 'piiRedaction'
  | 'dataSharing';

export type Enforcement = 'enforced' | 'planned';

export const DEFAULT_POLICY: SecurityPolicy = {
  egressProxy: true,
  autoApproveLowRisk: true,
  constitutionStrictness: 'balanced',
  quarantineNewSkills: true,
  biometricApproval: false,
  allowShellExec: false,
  piiRedaction: true,
  dataSharing: false,
  allowedDomains: [],
  blockedDomains: [],
  biometricSupported: false,
};

/**
 * Honest enforcement map (Constitution Art. IV.2 — degraded is never shown
 * as working). "Enforced" means this build's approval gate / audit writer
 * actually changes behaviour when the switch moves; "Planned" means the
 * preference persists and nothing else happens yet. Tooltips show `note`.
 */
export const POLICY_META: Record<
  PolicyToggleKey | 'constitutionStrictness',
  { label: string; description: string; enforcement: Enforcement; note: string }
> = {
  autoApproveLowRisk: {
    label: 'Auto-approve low-risk actions',
    description:
      'Read-only, reversible actions inside XR run without a prompt and are logged as auto-approved. Remember rules you created apply either way.',
    enforcement: 'enforced',
    note: 'Enforced by the approval gate in this build: low-risk requests skip the modal only while this is on.',
  },
  allowShellExec: {
    label: 'Allow shell execution',
    description:
      'Off: shell requests are blocked before they reach you and logged. On: every shell command still asks first.',
    enforcement: 'enforced',
    note: 'Enforced by the approval gate: a shell request is answered "blocked" without a prompt while this is off.',
  },
  quarantineNewSkills: {
    label: 'Quarantine new skills',
    description:
      'Skills without a trusted signature cannot auto-run: each request prompts at high risk and ignores remember rules until you trust the skill.',
    enforcement: 'enforced',
    note: 'Enforced by the approval gate for the skills listed under Quarantine.',
  },
  piiRedaction: {
    label: 'Redact personal info',
    description:
      'Emails, phone and card numbers are masked before they are written to the audit log. The same switch will cover cloud provider calls when they arrive (Phase 14).',
    enforcement: 'enforced',
    note: 'Enforced for audit records today; provider-call redaction lands with the real LLM pipeline.',
  },
  egressProxy: {
    label: 'Route traffic through the egress proxy',
    description:
      'Every outbound request would be proxied, logged and checked against the lists below. Nothing is proxied in this build.',
    enforcement: 'planned',
    note: 'Planned: the preference and your domain lists persist; the proxy itself is not configured yet.',
  },
  biometricApproval: {
    label: 'Biometric confirmation for high-risk approvals',
    description:
      'Ask for Touch ID / Windows Hello before a high-risk approval is accepted.',
    enforcement: 'planned',
    note: 'Planned: this build cannot show an OS biometric prompt, so the switch is unavailable.',
  },
  dataSharing: {
    label: 'Share anonymous usage data',
    description:
      'Off by default. No telemetry pipeline exists in this build, so nothing is sent either way. Mirrors Settings → Privacy.',
    enforcement: 'planned',
    note: 'Planned: there is no telemetry pipeline yet; the preference is kept for the day there is one.',
  },
  constitutionStrictness: {
    label: 'Constitution strictness',
    description:
      'How XR resolves ambiguity: relaxed asks less, strict asks more. Today this only persists; the agent runtime reads it in Phase 14.',
    enforcement: 'planned',
    note: 'Planned: persisted, not yet read by any gate.',
  },
};

// ─── Quarantine ────────────────────────────────────────────────────────────

export type QuarantineStatus = 'quarantined' | 'trusted' | 'removed';

export interface QuarantinedSkill {
  id: string;
  name: string;
  version: string;
  source: string;
  reason: string;
  quarantinedAt: number;
  status: QuarantineStatus;
}

// ─── Gate ──────────────────────────────────────────────────────────────────

/** What the pure gate decides before a request may reach the human. */
export type GateOutcome =
  | {
      kind: 'decide';
      status: 'approved' | 'denied';
      decision: AuditDecision;
      reason: string;
      ruleId: string;
    }
  | { kind: 'prompt'; quarantined: boolean };

export interface GateContext {
  paused: boolean;
  policy: SecurityPolicy;
  quarantine: QuarantinedSkill[];
}

// ─── Screen ────────────────────────────────────────────────────────────────

export type ShieldTab = 'status' | 'approvals' | 'audit' | 'security';

export const SHIELD_TABS: readonly { id: ShieldTab; label: string }[] = [
  { id: 'status', label: 'Status' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'audit', label: 'Audit Log' },
  { id: 'security', label: 'Security Settings' },
];

export function isShieldTab(value: unknown): value is ShieldTab {
  return SHIELD_TABS.some((t) => t.id === value);
}
