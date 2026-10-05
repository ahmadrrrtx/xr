/*
 * Shield backend seam (Phase 12).
 *
 * Inside the native shell every call is a Rust command (src-tauri/src/shield/
 * mod.rs — SQLite `shield_audit` + `shield.json`). In the plain browser (dev
 * preview / e2e) the same contract is served from memory + localStorage so
 * the screen, the gate and the chain behave identically — the hash chain is
 * computed with WebCrypto here and with `sha2` there, over the same
 * canonical bytes (shield/core.ts ⇄ shield/mod.rs).
 */
import { APP_VERSION } from '@/lib/appMeta';
import { isTauri } from '@/lib/tauri';
import { chainEntry, newAuditId, verifyChain } from '@/shield/core';
import { sha256Hex } from '@/shield/hash';
import { buildSeedChain, seedQuarantine } from '@/shield/seed';
import {
  CHECK_LABEL,
  DEFAULT_POLICY,
  isAuditDecision,
  type AuditEntry,
  type AuditInput,
  type ChainVerification,
  type HealthCheck,
  type QuarantinedSkill,
  type SecurityPolicy,
} from '@/shield/types';

export interface ShieldPersisted {
  policy: SecurityPolicy;
  paused: boolean;
  quarantine: QuarantinedSkill[];
  lastCheckedAt: number | null;
  lastChecks: HealthCheck[];
}

export interface AuditPage {
  entries: AuditEntry[];
  nextCursor: string | null;
  total: number;
}

export interface ShieldBackend {
  load(): Promise<ShieldPersisted>;
  /** Newest first; `cursor` is the last seen id. */
  listAudit(cursor: string | null, limit: number): Promise<AuditPage>;
  appendAudit(input: AuditInput): Promise<AuditEntry>;
  verifyChain(): Promise<ChainVerification>;
  /** Host-side checks: audit_db, keychain, audit_chain, settings_store, version_integrity. */
  hostChecks(): Promise<HealthCheck[]>;
  setPolicy(policy: SecurityPolicy): Promise<SecurityPolicy>;
  setPaused(paused: boolean): Promise<void>;
  setQuarantine(list: QuarantinedSkill[]): Promise<void>;
  saveChecks(checks: HealthCheck[], at: number): Promise<void>;
  /** Pause + broadcast `shield:emergency-revoke` (Rust) / DOM seam (browser). */
  revokeAll(pendingDenied: number, runsStopped: number): Promise<void>;
  saveExport(
    filename: string,
    text: string,
    mime: string
  ): Promise<{ saved: boolean; path: string | null }>;
}

// ─── Browser backend ───────────────────────────────────────────────────────

const LS = {
  policy: 'xr.shield.policy',
  paused: 'xr.shield.paused',
  quarantine: 'xr.shield.quarantine',
  checks: 'xr.shield.checks',
  audit: 'xr.shield.audit',
} as const;

const AUDIT_CAP = 2000;

function readJSON<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — memory copy still serves this session */
  }
}

function coercePolicy(value: unknown): SecurityPolicy {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_POLICY };
  const v = value as Partial<SecurityPolicy>;
  return {
    ...DEFAULT_POLICY,
    ...v,
    allowedDomains: Array.isArray(v.allowedDomains)
      ? v.allowedDomains.filter((d): d is string => typeof d === 'string')
      : [],
    blockedDomains: Array.isArray(v.blockedDomains)
      ? v.blockedDomains.filter((d): d is string => typeof d === 'string')
      : [],
    biometricSupported: false, // read-only: no OS prompt exists in this build
  };
}

function coerceEntry(value: unknown): AuditEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== 'string' ||
    typeof v.ts !== 'number' ||
    typeof v.actor !== 'string' ||
    typeof v.action !== 'string' ||
    !isAuditDecision(v.decision) ||
    typeof v.hash !== 'string'
  )
    return null;
  return {
    id: v.id,
    ts: v.ts,
    actor: v.actor,
    skill: typeof v.skill === 'string' ? v.skill : null,
    action: v.action,
    resource: typeof v.resource === 'string' ? v.resource : null,
    decision: v.decision,
    ruleId: typeof v.ruleId === 'string' ? v.ruleId : null,
    risk: v.risk === 'low' || v.risk === 'high' ? v.risk : 'medium',
    costUsd: typeof v.costUsd === 'number' ? v.costUsd : null,
    signature: null,
    prevHash: typeof v.prevHash === 'string' ? v.prevHash : null,
    hash: v.hash,
    detail: typeof v.detail === 'string' ? v.detail : null,
  };
}

/** Memory + localStorage. Chain order = array order (oldest first). */
class BrowserBackend implements ShieldBackend {
  private audit: AuditEntry[] | null = null;
  private seeding: Promise<AuditEntry[]> | null = null;

  private async chain(): Promise<AuditEntry[]> {
    if (this.audit) return this.audit;
    if (!this.seeding) {
      this.seeding = (async () => {
        const stored = readJSON<unknown[]>(LS.audit);
        const parsed = Array.isArray(stored)
          ? stored.map(coerceEntry).filter((e): e is AuditEntry => e !== null)
          : [];
        const entries =
          parsed.length > 0
            ? parsed
            : await buildSeedChain(Date.now(), sha256Hex);
        if (parsed.length === 0) writeJSON(LS.audit, entries);
        this.audit = entries;
        return entries;
      })();
    }
    return this.seeding;
  }

  private persistAudit(): void {
    if (!this.audit) return;
    writeJSON(LS.audit, this.audit.slice(-AUDIT_CAP));
  }

  async load(): Promise<ShieldPersisted> {
    const saved = readJSON<{ at: number; checks: HealthCheck[] }>(LS.checks);
    const quarantine = readJSON<QuarantinedSkill[]>(LS.quarantine);
    return {
      policy: coercePolicy(readJSON<unknown>(LS.policy)),
      paused: readJSON<boolean>(LS.paused) === true,
      quarantine: Array.isArray(quarantine)
        ? quarantine
        : seedQuarantine(Date.now()),
      lastCheckedAt: saved?.at ?? null,
      lastChecks: Array.isArray(saved?.checks) ? saved.checks : [],
    };
  }

  async listAudit(cursor: string | null, limit: number): Promise<AuditPage> {
    const all = await this.chain();
    const newestFirst = [...all].reverse();
    const start = cursor
      ? newestFirst.findIndex((e) => e.id === cursor) + 1
      : 0;
    const entries = newestFirst.slice(start, start + limit);
    const last = entries[entries.length - 1];
    return {
      entries,
      nextCursor: start + limit < newestFirst.length && last ? last.id : null,
      total: all.length,
    };
  }

  /** Appends are serialised: two writers must never share a `prevHash`. */
  private appendQueue: Promise<unknown> = Promise.resolve();

  appendAudit(input: AuditInput): Promise<AuditEntry> {
    const run = async (): Promise<AuditEntry> => {
      const all = await this.chain();
      const tail = all[all.length - 1] ?? null;
      const { ts, ...rest } = input;
      const entry = await chainEntry(
        { ...rest, id: newAuditId(), ts: ts ?? Date.now() },
        tail,
        sha256Hex
      );
      all.push(entry);
      this.persistAudit();
      return entry;
    };
    const next = this.appendQueue.then(run, run);
    this.appendQueue = next.catch(() => undefined);
    return next;
  }

  async verifyChain(): Promise<ChainVerification> {
    return verifyChain(await this.chain(), sha256Hex);
  }

  async hostChecks(): Promise<HealthCheck[]> {
    const t0 = performance.now();
    const all = await this.chain();
    const chain = await this.verifyChain();
    let settingsOk: boolean;
    try {
      const probe = `xr.shield.probe.${Date.now()}`;
      window.localStorage.setItem(probe, '1');
      settingsOk = window.localStorage.getItem(probe) === '1';
      window.localStorage.removeItem(probe);
    } catch {
      settingsOk = false;
    }
    const ms = Math.round(performance.now() - t0);
    return [
      {
        id: 'audit_db',
        label: CHECK_LABEL.audit_db,
        status: 'pass',
        detail: `${all.length} entries readable (browser preview: localStorage).`,
        critical: true,
        durationMs: ms,
      },
      {
        id: 'keychain',
        label: CHECK_LABEL.keychain,
        status: 'pass',
        detail:
          'Rules mirror reachable. The browser preview has no OS keychain; the native shell checks it.',
        critical: true,
      },
      {
        id: 'audit_chain',
        label: CHECK_LABEL.audit_chain,
        status: chain.valid ? 'pass' : 'fail',
        detail: chain.detail,
        critical: true,
        durationMs: ms,
      },
      {
        id: 'settings_store',
        label: CHECK_LABEL.settings_store,
        status: settingsOk ? 'pass' : 'fail',
        detail: settingsOk
          ? 'Preferences readable and writable.'
          : 'Preferences storage is not writable.',
        critical: true,
      },
      {
        id: 'version_integrity',
        label: CHECK_LABEL.version_integrity,
        status: 'pass',
        detail: `Webview ${APP_VERSION}. No native shell to compare against in the browser preview.`,
        critical: false,
      },
    ];
  }

  async setPolicy(policy: SecurityPolicy): Promise<SecurityPolicy> {
    const next = coercePolicy(policy);
    writeJSON(LS.policy, next);
    return next;
  }

  async setPaused(paused: boolean): Promise<void> {
    writeJSON(LS.paused, paused);
  }

  async setQuarantine(list: QuarantinedSkill[]): Promise<void> {
    writeJSON(LS.quarantine, list);
  }

  async saveChecks(checks: HealthCheck[], at: number): Promise<void> {
    writeJSON(LS.checks, { at, checks });
  }

  async revokeAll(pendingDenied: number, runsStopped: number): Promise<void> {
    writeJSON(LS.paused, true);
    if (import.meta.env.DEV) {
      window.dispatchEvent(
        new CustomEvent('xr-shield-seam', {
          detail: { kind: 'emergency-revoke', pendingDenied, runsStopped },
        })
      );
    }
  }

  async saveExport(filename: string, text: string, mime: string) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { saved: true, path: null };
  }
}

// ─── Tauri backend ─────────────────────────────────────────────────────────

async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

class TauriBackend implements ShieldBackend {
  load(): Promise<ShieldPersisted> {
    return invoke<ShieldPersisted>('get_shield_status');
  }
  listAudit(cursor: string | null, limit: number): Promise<AuditPage> {
    return invoke<AuditPage>('get_audit_log', { cursor, limit });
  }
  appendAudit(input: AuditInput): Promise<AuditEntry> {
    return invoke<AuditEntry>('append_audit', {
      input: { ...input, ts: input.ts ?? Date.now() },
    });
  }
  verifyChain(): Promise<ChainVerification> {
    return invoke<ChainVerification>('verify_audit_chain');
  }
  hostChecks(): Promise<HealthCheck[]> {
    return invoke<HealthCheck[]>('run_health_check', {
      webviewVersion: APP_VERSION,
    });
  }
  setPolicy(policy: SecurityPolicy): Promise<SecurityPolicy> {
    return invoke<SecurityPolicy>('set_security_policy', { policy });
  }
  setPaused(paused: boolean): Promise<void> {
    return invoke<void>('set_shield_paused', { paused });
  }
  setQuarantine(list: QuarantinedSkill[]): Promise<void> {
    return invoke<void>('set_quarantine', { list });
  }
  saveChecks(checks: HealthCheck[], at: number): Promise<void> {
    return invoke<void>('save_shield_checks', { checks, at });
  }
  revokeAll(pendingDenied: number, runsStopped: number): Promise<void> {
    return invoke<void>('revoke_all', { pendingDenied, runsStopped });
  }
  async saveExport(filename: string, text: string) {
    // Same Rust save dialog Phase 11 uses (filename-agnostic).
    const target = await invoke<string | null>('save_runs_export', {
      filename,
      contents: text,
    });
    return target
      ? { saved: true, path: target }
      : { saved: false, path: null };
  }
}

let backend: ShieldBackend | null = null;

export function shieldBackend(): ShieldBackend {
  if (!backend) backend = isTauri() ? new TauriBackend() : new BrowserBackend();
  return backend;
}

/** Test/e2e seam: swap the backend (browser only). */
export function setShieldBackend(next: ShieldBackend | null): void {
  backend = next;
}
