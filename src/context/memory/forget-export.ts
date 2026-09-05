/**
 * XR Phase 7 (F-21) — forgetting + portability for durable memory.
 *
 * forget (irreversible):
 *   `xr memory remove` is the UNDOABLE delete (ops ledger keeps a before-image).
 *   `forgetMemory` is the other thing the plan asks for: a deletion that is
 *   irreversible BY DESIGN — the row, its cached vectors and any ledger
 *   before-images that still hold its content are purged, open conflicts that
 *   reference it are closed, and one `memory.forgotten` audit row (ids +
 *   counts only, never content) is the only trace left.
 *
 * export (scoped, redaction-aware):
 *   JSON bundles are `xr-memory` v2 (v1 bundles still import). `--md` renders
 *   a human-readable report. Quarantined / revoked / proposed rows are exported
 *   ONLY when asked for and always carry their consent label — a poisoned item
 *   leaves the system labelled as evidence, never as a plain fact.
 */

import type { WorkspaceStore as Store } from "../../state/workspace-store.ts";
import { maskSecrets } from "../poison.ts";
import type { MemoryStore } from "./store.ts";
import type { MemoryEntryWithContext, MemoryExport } from "./types.ts";
import { closeConflictsFor } from "./provenance.ts";

export type ForgetTarget = { kind: "id"; id: string } | { kind: "query"; query: string } | { kind: "scope"; scope: string };

export interface ForgetResult {
  ok: boolean;
  forgotten: string[];
  /** Ledger rows (before/after images) that still carried the content and were purged too. */
  purgedLedgerRows: number;
  reason?: string;
}

/** Resolve what a forget target would remove — read-only, for the confirmation prompt. */
export function planForget(mem: MemoryStore, target: ForgetTarget): MemoryEntryWithContext[] {
  if (target.kind === "id") {
    const e = mem.get(target.id);
    return e ? [e] : [];
  }
  const all = mem.list({ includeExclusions: true, includeExpired: true, includeRevoked: true });
  if (target.kind === "scope") return all.filter((e) => e.scope === target.scope);
  const terms = target.query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return all.filter((e) => {
    const hay = `${e.content} ${e.tags.join(" ")} ${e.category}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/**
 * Irreversibly forget. Every step is best-effort on a pre-migration database;
 * the audit row is written LAST so it only ever claims what actually happened.
 */
export function forgetMemory(store: Store, mem: MemoryStore, target: ForgetTarget, actor = "user"): ForgetResult {
  const victims = planForget(mem, target);
  if (!victims.length) return { ok: false, forgotten: [], purgedLedgerRows: 0, reason: "nothing matched" };
  const forgotten: string[] = [];
  let purgedLedgerRows = 0;
  for (const v of victims) {
    // 1. destroy index state first so a crash mid-way cannot leave a resurrectable vector
    try {
      store.query(`UPDATE user_memory SET embedding=NULL, embedding_model=NULL, embedding_dim=NULL, content_hash=NULL, index_state='invalidated' WHERE id=?`).run(v.id);
    } catch { /* column set may predate the index columns */ }
    // 2. purge ledger images that still hold the content (this is what makes it irreversible)
    try {
      const r = store.query(`DELETE FROM context_ops WHERE target_table='user_memory' AND target_id=?`).run(v.id);
      purgedLedgerRows += (r as { changes?: number }).changes ?? 0;
    } catch { /* ledger table absent → nothing to purge */ }
    // 3. the projected context item (migration 2 reuses the memory id) and provenance links
    try { store.query(`DELETE FROM context_provenance WHERE item_id=?`).run(v.id); } catch { /* absent */ }
    try { store.query(`DELETE FROM context_items WHERE id=?`).run(v.id); } catch { /* absent */ }
    // 4. close arbitration rows that reference it (ledger keeps ids only)
    closeConflictsFor(store, v.id, "forgotten", actor);
    // 5. the row itself
    if (store.deleteMemory(v.id)) forgotten.push(v.id);
  }
  store.audit("memory.forgotten", {
    target: target.kind,
    ...(target.kind === "scope" ? { scope: target.scope } : {}),
    ids: forgotten,
    count: forgotten.length,
    purgedLedgerRows,
    actor,
    irreversible: true,
  });
  return { ok: forgotten.length > 0, forgotten, purgedLedgerRows };
}

// ── export ──────────────────────────────────────────────────────────────────

export interface ExportOptions {
  scope?: string;
  /** Carry quarantined/revoked/proposed rows (labelled). Default false. */
  includeQuarantined?: boolean;
  /** Mask secret-looking substrings in content (default true). */
  redact?: boolean;
}

/** A row that may only leave the system with its label attached. */
export function quarantineLabel(e: MemoryEntryWithContext): string | null {
  if (e.consentState === "quarantined") return "QUARANTINED";
  if (e.revokedAt || e.consentState === "revoked") return "REVOKED";
  if (e.consentState === "proposed") return "PROPOSED (not yet approved)";
  if (e.trustStatus === "untrusted_external") return "UNTRUSTED";
  return null;
}

/** Build the JSON bundle (v2). Redaction masks content; labels are data, not prose. */
export function exportBundle(mem: MemoryStore, opts: ExportOptions = {}): MemoryExport & { redacted: number; labelled: number } {
  const bundle = mem.export({ scope: opts.scope, includeQuarantined: opts.includeQuarantined });
  let redacted = 0;
  let labelled = 0;
  const entries = (bundle.entries as MemoryEntryWithContext[]).map((e) => {
    const label = quarantineLabel(e);
    if (label) labelled++;
    let content = e.content;
    if (opts.redact !== false) {
      const m = maskSecrets(content);
      if (m.masked) redacted += m.masked;
      content = m.text;
    }
    return { ...e, content, ...(label ? { quarantineLabel: label } : {}) };
  });
  return { ...bundle, entries, redacted, labelled };
}

/** Render a bundle as Markdown — one section per scope, quarantine labels inline. */
export function renderMarkdown(bundle: ReturnType<typeof exportBundle>): string {
  const byScope = new Map<string, Array<MemoryEntryWithContext & { quarantineLabel?: string }>>();
  for (const e of bundle.entries as Array<MemoryEntryWithContext & { quarantineLabel?: string }>) {
    const arr = byScope.get(e.scope) ?? [];
    arr.push(e);
    byScope.set(e.scope, arr);
  }
  const lines = [
    `# XR memory export`,
    ``,
    `- exported: ${new Date(bundle.exportedAt).toISOString()}`,
    `- entries: ${bundle.entries.length} · labelled (quarantined/revoked/proposed/untrusted): ${bundle.labelled} · secrets masked: ${bundle.redacted}`,
    `- format: xr-memory v${bundle.version}`,
    ``,
  ];
  for (const [scope, entries] of [...byScope.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`## scope: ${scope}`, ``);
    for (const e of entries) {
      const label = e.quarantineLabel ? ` **[${e.quarantineLabel}]**` : "";
      const vis = e.agentVisibility && !e.agentVisibility.includes("*") ? ` · visible to: ${e.agentVisibility.join(", ")}` : "";
      lines.push(`- \`${e.id}\` (${e.category}${e.kind ? `/${e.kind}` : ""}, ★${e.importance})${label} ${e.content.replace(/\s+/g, " ")}`);
      lines.push(`  - source: ${e.source} · consent: ${e.consentState ?? "legacy_unknown"} · trust: ${e.trustStatus ?? "unknown"}${vis}${e.supersededBy ? ` · superseded by ${e.supersededBy}` : ""}`);
    }
    lines.push(``);
  }
  return lines.join("\n");
}
