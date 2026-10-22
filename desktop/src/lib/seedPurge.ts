/**
 * XR-LAUNCH-009 — demo ("seed") data never reaches a production install.
 *
 * Earlier builds wrote scripted demo rows on first launch: ~220 spend events,
 * a 204-entry audit chain and three quarantined skills. Production builds no
 * longer seed anything (every seed call sits behind `import.meta.env.DEV`, so
 * the seed modules are dropped from the shipped bundle). This module is the
 * one-time cleanup for installs that already have those rows.
 *
 * Seed rows are recognised by markers only the seed generators produce — the
 * patterns here never match a row the app writes for real:
 *   spend events   `sp_seed_NNNN`            (live ids are `sp_<uuid>`)
 *   audit entries  `aud_NNNNNN` (6 digits)   (live ids are `aud_` + 8 hex)
 *   quarantine     the three fixed demo skills, matched on id+version+source
 *
 * Mirrors `desktop/src-tauri/src/seed_purge.rs` (the packaged app's SQLite).
 * This file must not contain seed CONTENT (names, prompts, paths): CI greps
 * the production bundle for that content.
 */
import { chainEntry, newAuditId, type HashFn } from '@/shield/core';
import type { AuditEntry, QuarantinedSkill } from '@/shield/types';

export const SEED_PURGE_VERSION = 1;

export function isSeedSpendId(id: string): boolean {
  return /^sp_seed_\d{4}$/.test(id);
}

export function isSeedAuditId(id: string): boolean {
  return /^aud_\d{6}$/.test(id);
}

const SEED_QUARANTINE: ReadonlyArray<readonly [string, string, string]> = [
  ['figma-plugin', '0.3.1', 'Skills Store · unsigned'],
  ['legacy-exec', '1.0.0', 'Local install'],
  ['unknown-skill', '—', 'Sideloaded'],
];

export function isSeedQuarantine(
  q: Pick<QuarantinedSkill, 'id' | 'version' | 'source'>
): boolean {
  return SEED_QUARANTINE.some(
    ([id, version, source]) =>
      q.id === id && q.version === version && q.source === source
  );
}

export function purgeSeedSpend<T extends { id: string }>(
  events: readonly T[]
): { kept: T[]; removed: number } {
  const kept = events.filter((e) => !isSeedSpendId(e.id));
  return { kept, removed: events.length - kept.length };
}

export function purgeSeedQuarantine<
  T extends Pick<QuarantinedSkill, 'id' | 'version' | 'source'>,
>(list: readonly T[]): { kept: T[]; removed: number } {
  const kept = list.filter((q) => !isSeedQuarantine(q));
  return { kept, removed: list.length - kept.length };
}

export const PURGE_AUDIT_ACTION = 'Demo entries removed';

/**
 * Drop seed entries from an audit chain and re-link what remains.
 *
 * The real entries keep their content, ids, timestamps and order; only
 * `prevHash`/`hash` are recomputed (their predecessor was a demo row). A system
 * entry recording the removal is appended so the rewrite is itself on the
 * chain. With no seed entries the input is returned untouched.
 */
export async function rechainWithoutSeed(
  entries: readonly AuditEntry[],
  sha256: HashFn,
  now: number = Date.now()
): Promise<{ entries: AuditEntry[]; removed: number }> {
  const real = entries.filter((e) => !isSeedAuditId(e.id));
  const removed = entries.length - real.length;
  if (removed === 0) return { entries: [...entries], removed: 0 };
  const out: AuditEntry[] = [];
  let tail: AuditEntry | null = null;
  for (const e of real) {
    const { hash: _h, prevHash: _p, signature: _s, ...input } = e;
    tail = await chainEntry(input, tail, sha256);
    out.push(tail);
  }
  tail = await chainEntry(
    {
      id: newAuditId(),
      ts: now,
      actor: 'system',
      skill: null,
      action: PURGE_AUDIT_ACTION,
      resource: null,
      decision: 'allowed',
      ruleId: null,
      risk: 'low',
      costUsd: null,
      detail: `${removed} demo entries written by an earlier build were removed; ${real.length} real entries re-chained (XR-LAUNCH-009).`,
    },
    tail,
    sha256
  );
  out.push(tail);
  return { entries: out, removed };
}
