/*
 * Shield / Trust Center state (Phase 12) — the one store for trust state.
 *
 * Owns: policy, paused, quarantine, the last health check, the audit log
 * (loaded pages, newest first), audit filter/sort/selection, the chain
 * verdict and the compromised modal. It does NOT copy the pending approval
 * queue — `approvalStore` stays canonical for that and this store reads it
 * (stats, bulk actions, the approval_queue check).
 *
 * Evidence rule: every state-changing action here writes an audit entry via
 * `addAuditEntry`, and every approval decision anywhere is recorded by the
 * observer in shield/enforce.ts. Nothing in the UI claims "all clear"
 * before `runHealthCheck` has completed at least once (`checks` empty →
 * state `unknown`).
 */
import { toast } from 'sonner';
import { create } from 'zustand';

import { decideApproval } from '@/lib/approvalEvents';
import { shieldBackend } from '@/shield/api';
import {
  auditToCsv,
  auditToJson,
  computeStats,
  ctaFor,
  deriveState,
  exportFilename,
  filterAudit,
  headlineFor,
  issueCount,
  nextAuditSort,
  policyPatch,
  redactIfEnabled,
  sortAudit,
  subtitleFor,
} from '@/shield/core';
import {
  CHECK_IDS,
  CHECK_LABEL,
  DEFAULT_AUDIT_FILTER,
  DEFAULT_AUDIT_SORT,
  DEFAULT_POLICY,
  type AuditEntry,
  type AuditFilter,
  type AuditInput,
  type AuditSort,
  type ChainVerification,
  type HealthCheck,
  type QuarantinedSkill,
  type SecurityPolicy,
  type ShieldState,
  type ShieldStatus,
} from '@/shield/types';
import { useApprovalStore } from '@/stores/approvalStore';
import { useRunsStore } from '@/stores/runsStore';
import { useSettingsStore } from '@/stores/settingsStore';

const PAGE = 100;
/** The spinner must be visible long enough to read as "something ran". */
const MIN_CHECK_MS = 600;
/** A request waiting longer than this makes the approval_queue check warn. */
const STALE_PENDING_MS = 10 * 60_000;

export type HistoryFilter = 'all' | 'user' | 'auto';

export interface ShieldStoreState {
  hydrated: boolean;
  loading: boolean;
  error: string | null;

  policy: SecurityPolicy;
  paused: boolean;
  quarantine: QuarantinedSkill[];

  checks: HealthCheck[];
  lastCheckedAt: number | null;
  healthRunning: boolean;
  /** Dev-only: next health check reports a simulated integrity failure. */
  forcedFailure: boolean;

  /** Loaded audit pages, newest first. */
  audit: AuditEntry[];
  auditTotal: number;
  auditCursor: string | null;
  auditHasMore: boolean;
  auditLoading: boolean;
  auditFilter: AuditFilter;
  auditSort: AuditSort;
  /** Progressive reveal window over the filtered list (infinite scroll). */
  auditVisible: number;
  selectedAuditId: string | null;
  chain: ChainVerification | null;

  historyFilter: HistoryFilter;
  compromisedModalOpen: boolean;
  revokeDialogOpen: boolean;
  resumeDialogOpen: boolean;
  /** aria-live announcement (counter lets identical texts re-announce). */
  announce: { n: number; text: string } | null;

  load: () => Promise<void>;
  refresh: () => Promise<void>;
  runHealthCheck: () => Promise<void>;
  setForcedFailure: (on: boolean) => void;

  decideApproval: (
    id: string,
    status: 'approved' | 'denied',
    opts?: { remember?: 'always' | '1h'; reason?: string }
  ) => void;
  bulkApproveLowRisk: () => void;
  bulkDenyAll: () => void;
  setHistoryFilter: (f: HistoryFilter) => void;

  openRevokeDialog: () => void;
  closeRevokeDialog: () => void;
  revokeAll: () => Promise<void>;
  openResumeDialog: () => void;
  closeResumeDialog: () => void;
  resume: () => Promise<void>;

  loadAuditPage: () => Promise<void>;
  loadAllAudit: () => Promise<void>;
  setAuditFilter: (patch: Partial<AuditFilter>) => void;
  setAuditSort: (col: AuditSort['col']) => void;
  revealMoreAudit: () => void;
  selectAudit: (id: string | null) => void;
  exportAudit: (format: 'csv' | 'json') => Promise<void>;
  verifyChain: () => Promise<ChainVerification>;

  setPolicy: (patch: Partial<SecurityPolicy>) => Promise<void>;
  addAuditEntry: (input: AuditInput) => Promise<AuditEntry | null>;

  trustSkill: (id: string) => Promise<void>;
  removeSkill: (id: string) => Promise<void>;

  openCompromised: () => void;
  dismissCompromised: () => void;
}

/** Order checks the way the brief lists them (1–9), unknown ids last. */
function orderChecks(checks: HealthCheck[]): HealthCheck[] {
  const rank = new Map(CHECK_IDS.map((id, i) => [id, i]));
  return [...checks].sort(
    (a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99)
  );
}

/** Checks that only the webview can answer (queue, policy-derived rows). */
function localChecks(policy: SecurityPolicy): HealthCheck[] {
  const pending = useApprovalStore.getState().pending;
  const now = Date.now();
  const stale = pending.filter((r) => now - r.createdAt > STALE_PENDING_MS);
  const oldest = stale.reduce((acc, r) => Math.max(acc, now - r.createdAt), 0);
  return [
    {
      id: 'approval_queue',
      label: CHECK_LABEL.approval_queue,
      status: stale.length > 0 ? 'warn' : 'pass',
      detail:
        stale.length > 0
          ? `${stale.length} ${stale.length === 1 ? 'request has' : 'requests have'} waited ${Math.round(oldest / 60_000)} min — review it under Approvals.`
          : pending.length > 0
            ? `${pending.length} pending, none older than 10 min. Queue responsive.`
            : 'Queue empty and responsive.',
      critical: true,
    },
    {
      id: 'egress_proxy',
      label: CHECK_LABEL.egress_proxy,
      status: 'planned',
      detail:
        'Not configured. The proxy arrives with the real network layer (Phase 14); your domain lists are kept until then.',
      critical: false,
    },
    {
      id: 'biometric',
      label: CHECK_LABEL.biometric,
      status: 'planned',
      detail: policy.biometricSupported
        ? 'Available.'
        : 'Unavailable on this build — no OS prompt is wired yet.',
      critical: false,
    },
    {
      id: 'pii_redaction',
      label: CHECK_LABEL.pii_redaction,
      status: 'pass',
      detail: policy.piiRedaction
        ? 'On — emails, phone and card numbers are masked in audit records.'
        : 'Off (your choice) — identifiers are recorded as written.',
      critical: false,
    },
  ];
}

/** Dev trigger: make two checks fail so the compromised path can be exercised. */
function simulateFailure(checks: HealthCheck[]): HealthCheck[] {
  return checks.map((c) => {
    if (c.id === 'audit_chain')
      return {
        ...c,
        status: 'fail',
        detail:
          'Simulated for development: link 42 does not match its recorded hash.',
      };
    if (c.id === 'version_integrity')
      return {
        ...c,
        status: 'fail',
        detail:
          'Simulated for development: webview build does not match the shell.',
      };
    return c;
  });
}

function summarizeChecks(checks: HealthCheck[]): string {
  const n = (s: HealthCheck['status']): number =>
    checks.filter((c) => c.status === s).length;
  const parts = [`${checks.length} checks`, `${n('pass')} passed`];
  if (n('warn')) parts.push(`${n('warn')} warnings`);
  if (n('fail')) parts.push(`${n('fail')} failed`);
  if (n('planned')) parts.push(`${n('planned')} planned`);
  return parts.join(' · ');
}

/** PII + data-sharing live in Settings → Privacy; mirror them into the policy. */
function withSettingsMirror(policy: SecurityPolicy): SecurityPolicy {
  const privacy = useSettingsStore.getState().settings.privacy;
  return {
    ...policy,
    piiRedaction: privacy.redactPii,
    dataSharing: privacy.telemetry,
  };
}

export const useShieldStore = create<ShieldStoreState>((set, get) => {
  const announce = (text: string): void =>
    set((s) => ({ announce: { n: (s.announce?.n ?? 0) + 1, text } }));

  const backend = () => shieldBackend();

  // Audit writes are serialised so the in-memory order matches the chain
  // order whatever the backend does (bulk actions fire many at once).
  let auditQueue: Promise<unknown> = Promise.resolve();

  return {
    hydrated: false,
    loading: false,
    error: null,

    policy: DEFAULT_POLICY,
    paused: false,
    quarantine: [],

    checks: [],
    lastCheckedAt: null,
    healthRunning: false,
    forcedFailure: false,

    audit: [],
    auditTotal: 0,
    auditCursor: null,
    auditHasMore: true,
    auditLoading: false,
    auditFilter: DEFAULT_AUDIT_FILTER,
    auditSort: DEFAULT_AUDIT_SORT,
    auditVisible: PAGE,
    selectedAuditId: null,
    chain: null,

    historyFilter: 'all',
    compromisedModalOpen: false,
    revokeDialogOpen: false,
    resumeDialogOpen: false,
    announce: null,

    load: async () => {
      if (get().hydrated || get().loading) return;
      set({ loading: true, error: null });
      try {
        const persisted = await backend().load();
        set({
          policy: withSettingsMirror(persisted.policy),
          paused: persisted.paused,
          quarantine: persisted.quarantine,
          checks: orderChecks(persisted.lastChecks),
          lastCheckedAt: persisted.lastCheckedAt,
          hydrated: true,
          loading: false,
        });
        await get().loadAllAudit();
        // Honest default: the first visit runs the checks instead of showing
        // a stale or invented verdict.
        if (persisted.lastChecks.length === 0) void get().runHealthCheck();
      } catch (e) {
        set({
          loading: false,
          hydrated: true,
          error:
            e instanceof Error
              ? e.message
              : 'Could not reach the XR Shield store. Restart XR or check logs.',
        });
      }
    },

    refresh: async () => {
      set({ audit: [], auditCursor: null, auditHasMore: true, auditTotal: 0 });
      await get().loadAllAudit();
    },

    runHealthCheck: async () => {
      if (get().healthRunning) return;
      set({ healthRunning: true });
      const started = Date.now();
      const wasCompromised = deriveState(get().checks) === 'compromised';
      let host: HealthCheck[];
      try {
        host = await backend().hostChecks();
      } catch (e) {
        host = [
          {
            id: 'audit_db',
            label: CHECK_LABEL.audit_db,
            status: 'fail',
            detail: `Could not reach the audit database: ${e instanceof Error ? e.message : String(e)}`,
            critical: true,
          },
        ];
      }
      let checks = orderChecks([...host, ...localChecks(get().policy)]);
      if (get().forcedFailure) checks = simulateFailure(checks);
      const elapsed = Date.now() - started;
      if (elapsed < MIN_CHECK_MS)
        await new Promise((r) => window.setTimeout(r, MIN_CHECK_MS - elapsed));
      const at = Date.now();
      const chain = checks.find((c) => c.id === 'audit_chain');
      set({
        checks,
        lastCheckedAt: at,
        healthRunning: false,
        chain: chain
          ? {
              valid: chain.status === 'pass',
              checked: get().auditTotal,
              brokenAt: null,
              detail: chain.detail,
              verifiedAt: at,
            }
          : get().chain,
      });
      void backend()
        .saveChecks(checks, at)
        .catch(() => undefined);
      const state = deriveState(checks);
      await get().addAuditEntry({
        actor: 'system',
        skill: null,
        action: 'Health check completed',
        resource: null,
        decision: state === 'compromised' ? 'error' : 'allowed',
        ruleId: null,
        risk: 'low',
        costUsd: null,
        detail: summarizeChecks(checks),
      });
      announce(
        state === 'protected'
          ? 'Health check complete. All checks passed.'
          : state === 'compromised'
            ? 'Health check complete. An integrity check failed.'
            : `Health check complete. ${issueCount(checks)} issues need a look.`
      );
      if (state === 'compromised' && !wasCompromised) {
        set({ compromisedModalOpen: true });
      }
    },

    setForcedFailure: (on) => set({ forcedFailure: on }),

    decideApproval: (id, status, opts = {}) => {
      decideApproval(id, status, { ...opts, decidedBy: 'user' });
    },

    bulkApproveLowRisk: () => {
      const low = useApprovalStore
        .getState()
        .pending.filter((r) => r.risk === 'low');
      if (low.length === 0) {
        toast('No low-risk requests pending');
        return;
      }
      for (const r of low)
        decideApproval(r.id, 'approved', { decidedBy: 'bulk', silent: true });
      toast.success(
        `Approved ${low.length} low-risk ${low.length === 1 ? 'request' : 'requests'}`
      );
      announce(`Approved ${low.length} low-risk requests.`);
    },

    bulkDenyAll: () => {
      const all = useApprovalStore.getState().pending;
      if (all.length === 0) return;
      for (const r of all)
        decideApproval(r.id, 'denied', {
          decidedBy: 'bulk',
          reason: 'Denied in bulk from Shield',
          silent: true,
        });
      toast.warning(
        `Denied ${all.length} ${all.length === 1 ? 'request' : 'requests'}`
      );
      announce(`Denied ${all.length} requests.`);
    },

    setHistoryFilter: (historyFilter) => set({ historyFilter }),

    openRevokeDialog: () => set({ revokeDialogOpen: true }),
    closeRevokeDialog: () => set({ revokeDialogOpen: false }),

    revokeAll: async () => {
      const pending = useApprovalStore.getState().pending;
      const n = pending.length;
      // Gate first: anything that arrives from here on is denied.
      set({ paused: true, revokeDialogOpen: false });
      for (const r of pending)
        decideApproval(r.id, 'denied', {
          decidedBy: 'bulk',
          reason: 'XR is paused — all actions blocked',
          auditDecision: 'blocked',
          silent: true,
        });
      // Stop every run in flight (Brain streams + Rust re-broadcast).
      const stopped = await useRunsStore
        .getState()
        .killAll('Paused by XR Shield emergency revoke', {
          silent: true,
          by: 'shield',
        });
      await get().addAuditEntry({
        actor: 'user',
        skill: null,
        action: 'Emergency revoke',
        resource: null,
        decision: 'blocked',
        ruleId: 'user.emergency-revoke',
        risk: 'high',
        costUsd: null,
        detail: `${n} pending ${n === 1 ? 'approval' : 'approvals'} denied · ${stopped} ${stopped === 1 ? 'run' : 'runs'} stopped · agents paused`,
      });
      try {
        await backend().revokeAll(n, stopped);
      } catch {
        /* the local gate is already closed; the host flag is best-effort */
      }
      toast.error(
        `XR Shield: All agents paused. ${n} pending ${n === 1 ? 'approval' : 'approvals'} denied.`,
        {
          description: `${stopped} ${stopped === 1 ? 'run' : 'runs'} stopped. Finished work is untouched; new requests are blocked until you resume.`,
          duration: 8000,
          className: 'xr-toast-wide',
        }
      );
      announce(
        `XR Shield paused all agents. ${n} pending approvals denied, ${stopped} runs stopped.`
      );
    },

    openResumeDialog: () => set({ resumeDialogOpen: true }),
    closeResumeDialog: () => set({ resumeDialogOpen: false }),

    resume: async () => {
      set({ paused: false, resumeDialogOpen: false });
      try {
        await backend().setPaused(false);
      } catch {
        /* local state already resumed */
      }
      await get().addAuditEntry({
        actor: 'user',
        skill: null,
        action: 'Agents resumed',
        resource: null,
        decision: 'allowed',
        ruleId: 'user.resume',
        risk: 'low',
        costUsd: null,
        detail: 'New requests prompt again.',
      });
      toast('Agents resumed', { description: 'New requests prompt again.' });
      announce('Agents resumed.');
    },

    loadAuditPage: async () => {
      const st = get();
      if (st.auditLoading || !st.auditHasMore) return;
      set({ auditLoading: true });
      try {
        const page = await backend().listAudit(st.auditCursor, PAGE);
        const seen = new Set(get().audit.map((e) => e.id));
        const fresh = page.entries.filter((e) => !seen.has(e.id));
        set((s) => ({
          audit: [...s.audit, ...fresh],
          auditCursor: page.nextCursor,
          auditHasMore: page.nextCursor !== null,
          auditTotal: page.total,
          auditLoading: false,
          error: null,
        }));
      } catch (e) {
        set({
          auditLoading: false,
          auditHasMore: false,
          error:
            e instanceof Error
              ? e.message
              : 'Could not load the audit log. Restart XR or check logs.',
        });
      }
    },

    loadAllAudit: async () => {
      // Pages are small; filters run client-side, so pull everything.
      let guard = 0;
      while (get().auditHasMore && guard < 50) {
        guard += 1;
        await get().loadAuditPage();
      }
    },

    setAuditFilter: (patch) =>
      set((s) => ({
        auditFilter: { ...s.auditFilter, ...patch },
        auditVisible: PAGE,
        selectedAuditId: null,
      })),

    setAuditSort: (col) =>
      set((s) => ({
        auditSort: nextAuditSort(s.auditSort, col),
        auditVisible: PAGE,
      })),

    revealMoreAudit: () =>
      set((s) => ({ auditVisible: s.auditVisible + PAGE })),

    selectAudit: (selectedAuditId) => set({ selectedAuditId }),

    exportAudit: async (format) => {
      const st = get();
      const rows = sortAudit(
        filterAudit(st.audit, st.auditFilter, Date.now()),
        st.auditSort
      );
      const text = format === 'csv' ? auditToCsv(rows) : auditToJson(rows);
      const filename = exportFilename(format);
      try {
        const res = await backend().saveExport(
          filename,
          text,
          format === 'csv' ? 'text/csv' : 'application/json'
        );
        if (!res.saved) return; // dialog cancelled
        toast.success(
          `Exported ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`,
          {
            description: res.path ?? filename,
          }
        );
        announce(`Exported ${rows.length} audit entries.`);
      } catch (e) {
        toast.error('Export failed', {
          description: e instanceof Error ? e.message : String(e),
        });
      }
    },

    verifyChain: async () => {
      const chain = await backend().verifyChain();
      set({ chain });
      return chain;
    },

    setPolicy: async (patch) => {
      const prev = get().policy;
      const next = policyPatch(prev, patch);
      set({ policy: next });
      // Settings → Privacy owns these two; keep the single source in sync.
      const settings = useSettingsStore.getState();
      if (
        patch.piiRedaction !== undefined &&
        settings.settings.privacy.redactPii !== next.piiRedaction
      )
        settings.update('privacy', { redactPii: next.piiRedaction });
      if (
        patch.dataSharing !== undefined &&
        settings.settings.privacy.telemetry !== next.dataSharing
      )
        settings.update('privacy', { telemetry: next.dataSharing });
      try {
        await backend().setPolicy(next);
      } catch (e) {
        set({ policy: prev });
        toast.error('Could not save the policy', {
          description: e instanceof Error ? e.message : String(e),
        });
        return;
      }
      const changed = (Object.keys(patch) as (keyof SecurityPolicy)[]).filter(
        (k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k])
      );
      if (changed.length === 0) return;
      const describe = (k: keyof SecurityPolicy): string => {
        const v = next[k];
        return Array.isArray(v)
          ? `${k}: ${v.length} ${v.length === 1 ? 'entry' : 'entries'}`
          : `${k}: ${String(v)}`;
      };
      await get().addAuditEntry({
        actor: 'user',
        skill: null,
        action: 'Policy updated',
        resource: null,
        decision: 'allowed',
        ruleId: 'user.policy',
        risk: 'low',
        costUsd: null,
        detail: changed.map(describe).join(' · '),
      });
    },

    addAuditEntry: (input) => {
      const redact = get().policy.piiRedaction;
      const clean: AuditInput = {
        ...input,
        ts: input.ts ?? Date.now(),
        resource: redactIfEnabled(input.resource, redact),
        detail: redactIfEnabled(input.detail, redact),
      };
      const write = async (): Promise<AuditEntry | null> => {
        try {
          const entry = await backend().appendAudit(clean);
          set((s) => ({
            audit: [entry, ...s.audit],
            auditTotal: s.auditTotal + 1,
          }));
          return entry;
        } catch (e) {
          set({
            error:
              e instanceof Error
                ? `Audit write failed: ${e.message}`
                : 'Audit write failed.',
          });
          return null;
        }
      };
      const next = auditQueue.then(write, write);
      auditQueue = next;
      return next;
    },

    trustSkill: async (id) => {
      const skill = get().quarantine.find((s) => s.id === id);
      if (!skill) return;
      const list = get().quarantine.map((s) =>
        s.id === id ? { ...s, status: 'trusted' as const } : s
      );
      set({ quarantine: list });
      await backend()
        .setQuarantine(list)
        .catch(() => undefined);
      await get().addAuditEntry({
        actor: 'user',
        skill: id,
        action: 'Skill trusted',
        resource: `${skill.name} ${skill.version}`,
        decision: 'allowed',
        ruleId: 'user.trust-skill',
        risk: 'high',
        costUsd: null,
        detail:
          'Left quarantine — requests now follow the normal approval rules.',
      });
      toast.success(`${skill.name} trusted`, {
        description: 'Its requests now follow the normal approval rules.',
      });
      announce(`${skill.name} trusted.`);
    },

    removeSkill: async (id) => {
      const skill = get().quarantine.find((s) => s.id === id);
      if (!skill) return;
      const list = get().quarantine.map((s) =>
        s.id === id ? { ...s, status: 'removed' as const } : s
      );
      set({ quarantine: list });
      await backend()
        .setQuarantine(list)
        .catch(() => undefined);
      await get().addAuditEntry({
        actor: 'user',
        skill: id,
        action: 'Skill removed',
        resource: `${skill.name} ${skill.version}`,
        decision: 'blocked',
        ruleId: 'user.remove-skill',
        risk: 'medium',
        costUsd: null,
        detail: 'Future requests from this skill are blocked.',
      });
      toast(`${skill.name} removed`, {
        description: 'Future requests from it are blocked.',
      });
      announce(`${skill.name} removed.`);
    },

    openCompromised: () => set({ compromisedModalOpen: true }),
    dismissCompromised: () => set({ compromisedModalOpen: false }),
  };
});

// ─── Selectors ─────────────────────────────────────────────────────────────

/** Trust state for dots/banner: paused reads as attention (intentional, not broken). */
export function selectShieldState(
  s: Pick<ShieldStoreState, 'checks'>
): ShieldState {
  return deriveState(s.checks);
}

/** Full status object the Status tab renders (pure given the two stores). */
export function buildStatus(
  s: Pick<
    ShieldStoreState,
    'checks' | 'paused' | 'audit' | 'quarantine' | 'lastCheckedAt'
  >,
  pending: number,
  now: number
): ShieldStatus {
  const state = deriveState(s.checks);
  const issues = issueCount(s.checks);
  return {
    state,
    headline: headlineFor(state),
    subtitle: subtitleFor(state, s.checks, s.paused),
    cta: ctaFor(state, issues),
    checks: s.checks,
    stats: computeStats(
      s.audit,
      pending,
      s.quarantine.filter((q) => q.status === 'quarantined').length,
      now
    ),
    lastCheckedAt: s.lastCheckedAt,
    paused: s.paused,
  };
}

/** Quarantined (not trusted/removed) skill ids — the gate + cards use it. */
export function isQuarantinedSkill(
  quarantine: readonly QuarantinedSkill[],
  skillId: string
): boolean {
  return quarantine.some((q) => q.id === skillId && q.status === 'quarantined');
}
