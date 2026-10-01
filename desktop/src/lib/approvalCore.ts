/*
 * Approval primitives (Phase 7) — pure, dependency-free logic so the queue,
 * rules and formatting are unit-testable headlessly (the orbCore.ts pattern).
 *
 * Components/stores/IPC live elsewhere:
 *   stores/approvalStore.ts   — Zustand queue + promise resolvers
 *   lib/approvalRules.ts      — persistence (Rust command + localStorage)
 *   lib/approvalEvents.ts     — surface-facing requestApproval()/notifies
 *
 * Real permission enforcement is Phase 12 (Shield); these shapes are the
 * contract every surface (chat, voice, bots, CLI) speaks from day one.
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export type ApprovalRisk = 'low' | 'medium' | 'high';

export const APPROVAL_RISKS: readonly ApprovalRisk[] = [
  'low',
  'medium',
  'high',
];

export function isApprovalRisk(value: unknown): value is ApprovalRisk {
  return (
    typeof value === 'string' &&
    (APPROVAL_RISKS as readonly string[]).includes(value)
  );
}

/** What the user asked XR to remember. "Allow once" = no key (the default). */
export type RememberKey = 'always' | '1h';

export const REMEMBER_KEYS: readonly RememberKey[] = ['always', '1h'];

export function isRememberKey(value: unknown): value is RememberKey {
  return (
    typeof value === 'string' &&
    (REMEMBER_KEYS as readonly string[]).includes(value)
  );
}

export type RuleDuration = 'forever' | '1h' | 'session';
export type RuleEffect = 'allow' | 'deny';

export const RULE_DURATIONS: readonly RuleDuration[] = [
  'forever',
  '1h',
  'session',
];

export function isRuleDuration(value: unknown): value is RuleDuration {
  return (
    typeof value === 'string' &&
    (RULE_DURATIONS as readonly string[]).includes(value)
  );
}

export function isRuleEffect(value: unknown): value is RuleEffect {
  return value === 'allow' || value === 'deny';
}

/**
 * A permission request from any surface. `resource` is the specific target
 * ("sarah@company.com", "/etc/hosts") or null when the action is generic
 * ("run shell commands") — remember-rule labels adapt to that.
 */
export interface ApprovalRequest {
  id: string;
  skillId: string;
  skillName: string;
  skillVersion: string;
  /** lucide icon key resolved by the modal (mail, file-edit, terminal, …). */
  skillIcon: string;
  action: string;
  resource: string | null;
  subject?: string;
  /** Collapsed by default; the modal reveals it via "Show details". */
  bodyPreview?: string;
  risk: ApprovalRisk;
  justification: string;
  createdAt: number;
  /** Optional per-request remember labels (defaults built from the fields). */
  rememberOptions?: { label: string; key: RememberKey }[];
}

/** The subset a caller supplies — id/createdAt are added by the queue. */
export type ApprovalSpec = Omit<ApprovalRequest, 'id' | 'createdAt'>;

/**
 * A remembered decision. Persisted for `forever`/`1h`; `session` rules live
 * in memory only. Deny rules can't be created from the modal yet — they
 * arrive with Shield (Phase 12) and bot surfaces — but matching supports
 * them now so those surfaces get auto-deny for free.
 */
export interface ApprovalRule {
  id: string;
  skillId: string;
  action: string;
  resource: string | null;
  effect: RuleEffect;
  duration: RuleDuration;
  createdAt: number;
}

/** How a request resolved. `auto` = a rule decided, not the human. */
export interface PendingDecision {
  status: 'approved' | 'denied';
  remember?: RememberKey;
  ruleId?: string;
  auto?: boolean;
  reason?: string;
}

export type NotificationType =
  | 'approval-request'
  | 'approval-decided'
  | 'success'
  | 'error'
  | 'warning'
  | 'info';

export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  'approval-request',
  'approval-decided',
  'success',
  'error',
  'warning',
  'info',
];

export function isNotificationType(
  value: unknown
): value is NotificationType {
  return (
    typeof value === 'string' &&
    (NOTIFICATION_TYPES as readonly string[]).includes(value)
  );
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body?: string;
  createdAt: number;
  read: boolean;
  data?: Record<string, unknown>;
}

// ─── Timing constants + dev overrides ──────────────────────────────────────

/** Auto-deny countdown while the user is away (window blurred/hidden). */
export const AUTO_DENY_MS_DEFAULT = 60_000;

/** "Allow for 1 hour" rule lifetime. */
export const RULE_1H_MS = 60 * 60 * 1000;

/** Bell popover shows the newest 20; the store keeps 100. */
export const NOTIFICATION_CAP = 100;
export const BELL_VISIBLE = 20;

/**
 * Dev override for the auto-deny countdown (localStorage
 * `xr.approval.autoDenyMs`) — e2e shortens it instead of waiting a minute.
 * Anything unparsable or non-positive falls back to the default.
 */
export function parseAutoDenyMs(raw: string | null): number {
  if (raw === null || raw === '') return AUTO_DENY_MS_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return AUTO_DENY_MS_DEFAULT;
  return Math.min(Math.floor(n), AUTO_DENY_MS_DEFAULT);
}

// ─── Ids ───────────────────────────────────────────────────────────────────

export function newApprovalId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `apr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Rule matching ─────────────────────────────────────────────────────────

/** True when `rule` authorizes/blocks `req` at time `now`. */
export function ruleMatches(
  rule: ApprovalRule,
  req: Pick<ApprovalRequest, 'skillId' | 'action' | 'resource'>,
  now: number
): boolean {
  if (rule.skillId !== req.skillId || rule.action !== req.action) return false;
  if (rule.resource !== req.resource) return false;
  if (rule.duration === 'forever' || rule.duration === 'session') return true;
  return now < rule.createdAt + RULE_1H_MS; // "1h" — unexpired only
}

/**
 * Drop expired "1h" rules (session rules pass through; the caller keeps
 * those memory-only anyway). Returns the pruned list.
 */
export function pruneRules(rules: ApprovalRule[], now: number): ApprovalRule[] {
  return rules.filter((r) =>
    r.duration === 'forever'
      ? true
      : r.duration === 'session'
        ? true
        : now < r.createdAt + RULE_1H_MS
  );
}

/**
 * The pre-modal gate: if a rule already decides this request, return the
 * decision the caller should apply silently. `null` → ask the human.
 * Pruned rules are returned so the store can replace its list.
 */
export function checkRules(
  rules: ApprovalRule[],
  req: ApprovalRequest,
  now: number
): { decision: PendingDecision | null; rules: ApprovalRule[] } {
  const kept = pruneRules(rules, now);
  const hit = kept.find((r) => ruleMatches(r, req, now));
  if (!hit) return { decision: null, rules: kept };
  return {
    decision: {
      status: hit.effect === 'allow' ? 'approved' : 'denied',
      auto: true,
      ruleId: hit.id,
    },
    rules: kept,
  };
}

/** Build the rule a "remember" checkbox creates (allow-effect, v1). */
export function ruleFromDecision(
  req: ApprovalRequest,
  remember: RememberKey,
  now: number
): ApprovalRule {
  return {
    id: newApprovalId(),
    skillId: req.skillId,
    action: req.action,
    resource: req.resource,
    effect: 'allow',
    duration: remember === 'always' ? 'forever' : '1h',
    createdAt: now,
  };
}

/** Rules worth persisting — "session" rules never survive a restart anyway. */
export function persistableRules(rules: ApprovalRule[]): ApprovalRule[] {
  return rules.filter((r) => r.duration !== 'session');
}

// ─── Queue ─────────────────────────────────────────────────────────────────

/**
 * After `decidedId` resolves, the modal shows the OLDEST remaining request.
 * (The bell popover / orb menu can still `activate` any buried one.)
 */
export function nextActiveId(
  pending: ApprovalRequest[],
  decidedId: string
): string | null {
  const rest = pending.filter((r) => r.id !== decidedId);
  return rest.length > 0 ? (rest[0]?.id ?? null) : null;
}

// ─── Copy ──────────────────────────────────────────────────────────────────

export const RISK_COPY: Record<
  ApprovalRisk,
  { label: string; explanation: string }
> = {
  low: {
    label: 'Low risk',
    explanation: 'Contained to XR and reversible.',
  },
  medium: {
    label: 'Medium risk',
    explanation: 'This reaches an external service or changes data outside XR.',
  },
  high: {
    label: 'High risk',
    explanation: 'This is hard or impossible to undo — review carefully.',
  },
};

/** "Always allow gmail-skill to Send email to sarah@company.com". */
export function rememberAlwaysLabel(req: ApprovalRequest): string {
  const target = req.resource ? ` ${lowerFirst(req.action)} to ${req.resource}` : ` ${lowerFirst(req.action)}`;
  return `Always allow ${req.skillName} to${target}`;
}

/** "Allow gmail-skill to Send email to sarah@company.com for 1 hour". */
export function remember1hLabel(req: ApprovalRequest): string {
  const target = req.resource ? ` ${lowerFirst(req.action)} to ${req.resource}` : ` ${lowerFirst(req.action)}`;
  return `Allow ${req.skillName} to${target} for 1 hour`;
}

function lowerFirst(s: string): string {
  return s.length > 0 ? (s[0]?.toLowerCase() ?? s) + s.slice(1) : s;
}

// ─── Notification feed helpers ─────────────────────────────────────────────

/** Newest-first, capped at NOTIFICATION_CAP. */
export function capNotifications(items: Notification[]): Notification[] {
  return items.slice(0, NOTIFICATION_CAP);
}

/** Bell copy: "Just now" / "2m ago" / "1h ago" / "3d ago". */
export function relativeTime(from: number, now: number): string {
  const s = Math.max(0, Math.floor((now - from) / 1000));
  if (s < 45) return 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Day separator label for the feed (Today / Yesterday / 'Mar 12'). */
export function dayLabel(from: number, now: number): string {
  const d1 = new Date(from);
  const d2 = new Date(now);
  const startOfDay = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round(
    (startOfDay(d2) - startOfDay(d1)) / (24 * 60 * 60 * 1000)
  );
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d1.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
