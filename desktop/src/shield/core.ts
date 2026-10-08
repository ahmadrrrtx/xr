/*
 * Shield pure logic (Phase 12) — the orbCore/runs-core pattern: no React,
 * no Tauri, no store imports, so the chain, the gate, the state derivation
 * and the formatting are unit-testable headlessly
 * (test/desktop/shield-core.test.ts). The Rust module mirrors the canonical
 * form + chain rules exactly; change both or neither.
 */
import type { ApprovalRequest, ApprovalRisk } from '@/lib/approvalCore';

import {
  type AuditActorKind,
  type AuditDecision,
  type AuditEntry,
  type AuditFilter,
  type AuditRange,
  type AuditSort,
  type ChainVerification,
  type CheckStatus,
  type GateContext,
  type GateOutcome,
  type HealthCheck,
  type SecurityPolicy,
  type ShieldState,
  type ShieldStats,
  type ShieldTab,
} from '@/shield/types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const AUDIT_RANGE_MS: Record<AuditRange, number> = {
  '24h': DAY,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
  all: Number.POSITIVE_INFINITY,
};

// ─── Canonical form + chain ────────────────────────────────────────────────

/** Cost → fixed 6-decimal string so JS and Rust hash identical bytes. */
export function canonicalCost(cost: number | null): string {
  return cost === null || !Number.isFinite(cost) ? '' : cost.toFixed(6);
}

/**
 * The bytes that get hashed: a JSON array of strings (identical escaping in
 * JSON.stringify and serde_json for every string the log can contain).
 * Field order is part of the contract.
 */
export function canonicalAuditString(
  e: Omit<AuditEntry, 'hash' | 'signature'>
): string {
  return JSON.stringify([
    e.id,
    String(e.ts),
    e.actor,
    e.skill ?? '',
    e.action,
    e.resource ?? '',
    e.decision,
    e.ruleId ?? '',
    e.risk,
    canonicalCost(e.costUsd),
    e.prevHash ?? '',
    e.detail ?? '',
  ]);
}

export type HashFn = (input: string) => Promise<string>;

/**
 * Walk `entries` in chain order (oldest first) and confirm every link:
 * `prevHash` equals the previous entry's `hash`, and `hash` equals the
 * digest of the canonical form. Fails closed on any mismatch.
 */
export async function verifyChain(
  entries: readonly AuditEntry[],
  sha256: HashFn,
  now: number = Date.now()
): Promise<ChainVerification> {
  let prev: string | null = null;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if ((e.prevHash ?? null) !== prev) {
      return {
        valid: false,
        checked: i,
        brokenAt: i,
        detail: `Link ${i + 1} of ${entries.length} does not point at its predecessor.`,
        verifiedAt: now,
      };
    }
    const expected = await sha256(canonicalAuditString(e));
    if (expected !== e.hash) {
      return {
        valid: false,
        checked: i,
        brokenAt: i,
        detail: `Entry ${e.id} does not match its recorded hash.`,
        verifiedAt: now,
      };
    }
    prev = e.hash;
  }
  return {
    valid: true,
    checked: entries.length,
    brokenAt: null,
    detail:
      entries.length === 0
        ? 'No entries yet — nothing to verify.'
        : `${entries.length} entries hash-chained and intact (Ed25519 signatures planned).`,
    verifiedAt: now,
  };
}

/** Append `input` to the chain whose last entry is `tail` (null = genesis). */
export async function chainEntry(
  input: Omit<AuditEntry, 'hash' | 'signature' | 'prevHash'>,
  tail: AuditEntry | null,
  sha256: HashFn
): Promise<AuditEntry> {
  const prevHash = tail?.hash ?? null;
  const hash = await sha256(canonicalAuditString({ ...input, prevHash }));
  return { ...input, prevHash, hash, signature: null };
}

// ─── State derivation ──────────────────────────────────────────────────────

/**
 * No completed checks → `unknown` (never green before a check ran).
 * A failing critical check → compromised. Any other fail or warn →
 * attention. `planned` rows describe features this build does not ship
 * and never move the state (there is nothing the user could fix).
 */
export function deriveState(checks: readonly HealthCheck[]): ShieldState {
  if (checks.length === 0) return 'unknown';
  if (checks.some((c) => c.status === 'fail' && c.critical))
    return 'compromised';
  if (checks.some((c) => c.status === 'fail' || c.status === 'warn'))
    return 'attention';
  return 'protected';
}

export function issueCount(checks: readonly HealthCheck[]): number {
  return checks.filter((c) => c.status === 'fail' || c.status === 'warn')
    .length;
}

export function headlineFor(state: ShieldState): string {
  switch (state) {
    case 'protected':
      return 'XR Shield: PROTECTED';
    case 'attention':
      return 'XR Shield: ATTENTION NEEDED';
    case 'compromised':
      return 'XR Shield: COMPROMISED';
    default:
      return 'XR Shield: CHECKING';
  }
}

export function subtitleFor(
  state: ShieldState,
  checks: readonly HealthCheck[],
  paused: boolean
): string {
  if (paused) return 'Paused — agents cannot act until you resume.';
  switch (state) {
    case 'protected':
      return 'Every check that ran passed. Approvals, audit chain and policy are active.';
    case 'attention': {
      const first = checks.find(
        (c) => c.status === 'fail' || c.status === 'warn'
      );
      return first
        ? `${first.label}: ${first.detail}`
        : 'One check needs a look.';
    }
    case 'compromised': {
      const first = checks.find((c) => c.status === 'fail' && c.critical);
      return first
        ? `${first.label} failed: ${first.detail}`
        : 'An integrity check failed.';
    }
    default:
      return 'Running the first health check…';
  }
}

export function ctaFor(state: ShieldState, issues: number): string {
  switch (state) {
    case 'protected':
      return '✓ All clear';
    case 'attention':
      return `Review ${issues} ${issues === 1 ? 'issue' : 'issues'}`;
    case 'compromised':
      return 'Resolve now';
    default:
      return 'Checking…';
  }
}

const CHECK_ORDER: Record<CheckStatus, number> = {
  fail: 0,
  warn: 1,
  pass: 2,
  planned: 3,
};

/** fail → warn → pass → planned; stable within a group. */
export function sortChecks(checks: readonly HealthCheck[]): HealthCheck[] {
  return checks
    .map((c, i) => ({ c, i }))
    .sort(
      (a, b) => CHECK_ORDER[a.c.status] - CHECK_ORDER[b.c.status] || a.i - b.i
    )
    .map(({ c }) => c);
}

// ─── The gate (runs before a request may reach the human) ──────────────────

/** Heuristic the mock surfaces share: what counts as a shell request. */
export function isShellRequest(
  req: Pick<ApprovalRequest, 'skillId' | 'skillIcon' | 'action'>
): boolean {
  return (
    req.skillId === 'shell-skill' ||
    req.skillIcon === 'terminal' ||
    /\b(shell|terminal)\b/i.test(req.action)
  );
}

/**
 * Pure policy gate. Order matters and fails closed (Art. IV.4):
 *   paused → blocked; removed skill → blocked; shell while shell is off →
 *   blocked; quarantined skill → prompt (high-risk, rules ignored);
 *   low-risk + auto-approve policy → auto-approved (never for a
 *   `humanOnly` request — a workflow human check always reaches a person);
 *   otherwise prompt.
 */
export function gateRequest(
  req: ApprovalRequest,
  ctx: GateContext
): GateOutcome {
  if (ctx.paused) {
    return {
      kind: 'decide',
      status: 'denied',
      decision: 'blocked',
      reason: 'XR is paused — all actions blocked',
      ruleId: 'policy.paused',
    };
  }
  const q = ctx.quarantine.find((s) => s.id === req.skillId);
  if (q?.status === 'removed') {
    return {
      kind: 'decide',
      status: 'denied',
      decision: 'blocked',
      reason: `Blocked by XR Shield — ${q.name} was removed`,
      ruleId: 'policy.quarantine.removed',
    };
  }
  if (!ctx.policy.allowShellExec && isShellRequest(req)) {
    return {
      kind: 'decide',
      status: 'denied',
      decision: 'blocked',
      reason:
        'Blocked by XR Shield — shell execution is disabled in Security Settings',
      ruleId: 'policy.shell-exec',
    };
  }
  if (ctx.policy.quarantineNewSkills && q?.status === 'quarantined') {
    return { kind: 'prompt', quarantined: true };
  }
  if (ctx.policy.autoApproveLowRisk && req.risk === 'low' && !req.humanOnly) {
    return {
      kind: 'decide',
      status: 'approved',
      decision: 'auto-approved',
      reason: 'Auto-approved by policy — low risk',
      ruleId: 'policy.auto-approve-low',
    };
  }
  return { kind: 'prompt', quarantined: false };
}

// ─── Audit filtering / sorting / stats ─────────────────────────────────────

export function actorKind(actor: string): AuditActorKind {
  if (actor === 'user') return 'user';
  if (actor === 'system') return 'system';
  return 'agent';
}

/** "agent:coder" → "coder"; "user"/"system" unchanged. */
export function actorLabel(actor: string): string {
  return actor.startsWith('agent:') ? actor.slice('agent:'.length) : actor;
}

export function filterAudit(
  entries: readonly AuditEntry[],
  f: AuditFilter,
  now: number
): AuditEntry[] {
  const needle = f.search.trim().toLowerCase();
  const since = now - AUDIT_RANGE_MS[f.range];
  return entries.filter((e) => {
    if (f.range !== 'all' && e.ts < since) return false;
    if (f.decision !== 'all' && e.decision !== f.decision) return false;
    if (f.actor !== 'all' && actorKind(e.actor) !== f.actor) return false;
    if (!needle) return true;
    return (
      e.action.toLowerCase().includes(needle) ||
      (e.resource?.toLowerCase().includes(needle) ?? false) ||
      (e.skill?.toLowerCase().includes(needle) ?? false) ||
      e.actor.toLowerCase().includes(needle) ||
      (e.ruleId?.toLowerCase().includes(needle) ?? false) ||
      e.id.toLowerCase().includes(needle)
    );
  });
}

export function sortAudit(
  entries: readonly AuditEntry[],
  sort: AuditSort
): AuditEntry[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    const av = sort.col === 'ts' ? a.ts : (a.costUsd ?? -1);
    const bv = sort.col === 'ts' ? b.ts : (b.costUsd ?? -1);
    if (av !== bv) return (av - bv) * dir;
    return (a.ts - b.ts) * -1 || a.id.localeCompare(b.id);
  });
}

export function nextAuditSort(
  prev: AuditSort,
  col: AuditSort['col']
): AuditSort {
  if (prev.col !== col) return { col, dir: 'desc' };
  return { col, dir: prev.dir === 'desc' ? 'asc' : 'desc' };
}

/** Decisions that mean "this did not run". */
export const NOT_RUN: ReadonlySet<AuditDecision> = new Set<AuditDecision>([
  'blocked',
  'denied',
  'quarantined',
]);

export function computeStats(
  entries: readonly AuditEntry[],
  pendingApprovals: number,
  quarantinedSkills: number,
  now: number
): ShieldStats {
  let blocked24h = 0;
  let decided30d = 0;
  let auto30d = 0;
  for (const e of entries) {
    if (e.ts >= now - DAY && NOT_RUN.has(e.decision)) blocked24h += 1;
    if (e.ts >= now - 30 * DAY && e.decision !== 'error') {
      decided30d += 1;
      if (e.decision === 'auto-approved') auto30d += 1;
    }
  }
  return {
    blocked24h,
    pendingApprovals,
    autoApprovedRate30d:
      decided30d === 0 ? null : Math.round((auto30d / decided30d) * 1000) / 10,
    quarantinedSkills,
  };
}

export function recentActivity(
  entries: readonly AuditEntry[],
  n = 10
): AuditEntry[] {
  return sortAudit(entries, { col: 'ts', dir: 'desc' }).slice(0, n);
}

// ─── Export ────────────────────────────────────────────────────────────────

export const AUDIT_CSV_COLUMNS = [
  'id',
  'ts',
  'time',
  'actor',
  'skill',
  'action',
  'resource',
  'decision',
  'ruleId',
  'risk',
  'costUsd',
  'prevHash',
  'hash',
  'signature',
  'detail',
] as const;

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const s = String(value);
  // Formula injection: neutralise leading = + - @ (spreadsheets execute them).
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function auditToCsv(entries: readonly AuditEntry[]): string {
  const lines = [AUDIT_CSV_COLUMNS.join(',')];
  for (const e of entries) {
    lines.push(
      [
        e.id,
        e.ts,
        new Date(e.ts).toISOString(),
        e.actor,
        e.skill,
        e.action,
        e.resource,
        e.decision,
        e.ruleId,
        e.risk,
        e.costUsd,
        e.prevHash,
        e.hash,
        e.signature,
        e.detail,
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return lines.join('\n') + '\n';
}

export function auditToJson(
  entries: readonly AuditEntry[],
  exportedAt: number = Date.now()
): string {
  return JSON.stringify(
    {
      exportedAt: new Date(exportedAt).toISOString(),
      integrity: 'sha256-hash-chain',
      signatures: 'planned (Ed25519)',
      count: entries.length,
      entries,
    },
    null,
    2
  );
}

/** xr-shield-audit-YYYY-MM-DD-HHmm.csv (local time, Phase 11 convention). */
export function exportFilename(
  ext: 'csv' | 'json',
  now: Date = new Date()
): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `xr-shield-audit-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.${ext}`;
}

// ─── PII redaction (what the audit log records) ────────────────────────────

const EMAIL_RE =
  /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const CARD_RE = /\b(?:\d[ -]?){12,15}(\d{4})\b/g;
const PHONE_RE =
  /(?<!\d)(?:\+?\d{1,3}[ -]?)?(?:\(?\d{3}\)?[ -]?)\d{3}[ -]?(\d{4})(?!\d)/g;
const SECRET_RE = /\b(sk|xoxb|ghp|AKIA)[-_]?[A-Za-z0-9]{8,}\b/g;

/**
 * Mask emails (`s•••@company.com`), card numbers (`•••• 4242`), phone
 * numbers (`••• ••• 0199`) and API-key-shaped tokens. Deterministic and
 * idempotent; the shape survives so a log line still reads naturally.
 */
export function redactPii(text: string): string {
  return text
    .replace(SECRET_RE, (_m, prefix: string) => `${prefix}-••••`)
    .replace(CARD_RE, (_m, last4: string) => `•••• ${last4}`)
    .replace(
      EMAIL_RE,
      (_m, first: string, domain: string) => `${first}•••@${domain}`
    )
    .replace(PHONE_RE, (_m, last4: string) => `••• ••• ${last4}`);
}

export function redactIfEnabled(
  text: string | null,
  enabled: boolean
): string | null {
  if (text === null) return null;
  return enabled ? redactPii(text) : text;
}

// ─── Domain lists ──────────────────────────────────────────────────────────

const HOSTNAME_RE =
  /^(?=.{1,253}$)(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** RFC 1123 host, lowercase, optional leading `*.` wildcard; no scheme/port. */
export function isValidHostname(value: string): boolean {
  return HOSTNAME_RE.test(value.trim().toLowerCase());
}

/** Lowercase, trim, drop empties/invalid, keep first occurrence. */
export function normalizeDomains(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const d = raw.trim().toLowerCase();
    if (!d || !isValidHostname(d) || out.includes(d)) continue;
    out.push(d);
  }
  return out;
}

export function policyPatch(
  policy: SecurityPolicy,
  patch: Partial<SecurityPolicy>
): SecurityPolicy {
  const next = { ...policy, ...patch };
  next.allowedDomains = normalizeDomains(next.allowedDomains);
  next.blockedDomains = normalizeDomains(next.blockedDomains);
  // The switch cannot be on where the OS prompt does not exist.
  if (!next.biometricSupported) next.biometricApproval = false;
  return next;
}

// ─── Formatting ────────────────────────────────────────────────────────────

export function fmtCost(cost: number | null): string {
  if (cost === null) return '—';
  if (cost === 0) return '$0';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function fmtPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

/** "14:02:31" for the audit table (local). */
export function fmtClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** "Oct 5, 14:02" for recent activity + the slide-over. */
export function fmtWhen(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "just now" / "2 min ago" / "3 h ago" / "4 d ago". */
export function fmtAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

export const DECISION_LABEL: Record<AuditDecision, string> = {
  allowed: 'Allowed',
  denied: 'Denied',
  'auto-approved': 'Auto-approved',
  quarantined: 'Quarantined',
  blocked: 'Blocked',
  error: 'Error',
};

export const RISK_LABEL: Record<ApprovalRisk, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

// ─── Keyboard ──────────────────────────────────────────────────────────────

const TAB_KEYS: Record<string, ShieldTab> = {
  '1': 'status',
  '2': 'approvals',
  '3': 'audit',
  '4': 'security',
};

export function tabForKey(key: string): ShieldTab | null {
  return TAB_KEYS[key] ?? null;
}

// ─── Ids ───────────────────────────────────────────────────────────────────

export function newAuditId(): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  return `aud_${rnd}`;
}
