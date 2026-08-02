/**
 * XR 4.5 — `xr context …` command surface.
 *
 * Progressive disclosure (§14): concise by default, full provenance on demand.
 * Accessibility (§14): every view has a `--json` form, status is never
 * conveyed by colour alone, and destructive actions require confirmation.
 */

import { ContextRepository, adaptStoreForContext } from "./repository.ts";
import { ContextInspection, residualDisclosure } from "./inspection.ts";
import { ProvenanceService } from "./provenance.ts";
import { MemoryStore, projectScopeFromCwd } from "./memory/store.ts";
import { isKnowledgeEnabled, loadConfig } from "../config/config.ts";
import { CONTEXT_BOUNDS, CONTEXT_POLICY_VERSION, TIER_POLICIES, CONTEXT_TIERS } from "./types.ts";
import { tierCeilingFor, tiersForMemoryScopeKind } from "./policy.ts";
import type { Store } from "../state/workspace-store.ts";

// Minimal, dependency-free formatting so this file never fights the CLI theme.
const C = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

/**
 * Status glyphs. Every one is a distinct SYMBOL, not just a colour, so the
 * output is readable in a screen reader and on a monochrome terminal.
 */
const GLYPH = {
  approved: "[ok]",
  proposed: "[?]",
  legacy: "[legacy]",
  revoked: "[revoked]",
  quarantined: "[!]",
  stale: "[stale]",
  fresh: "[fresh]",
};

interface Flags {
  json?: boolean;
  scope?: string;
  type?: string;
  all?: boolean;
  yes?: boolean;
  detailed?: boolean;
  limit?: number;
  reason?: string;
  /** Phase 6: --keep a|b|stale|both for `resolve`; --write for `benchmark`. */
  keep?: string;
  write?: boolean;
  olderThanDays?: number;
  _: string[];
}

function parseFlags(argv: string[]): Flags {
  const f: Flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--json") f.json = true;
    else if (a === "--all") f.all = true;
    else if (a === "-y" || a === "--yes") f.yes = true;
    else if (a === "--write") f.write = true;
    else if (a === "--detailed" || a === "-v") f.detailed = true;
    else if (a === "--scope") f.scope = argv[++i];
    else if (a === "--type") f.type = argv[++i];
    else if (a === "--reason") f.reason = argv[++i];
    else if (a === "--keep") f.keep = argv[++i];
    else if (a === "--older-than") f.olderThanDays = Number(argv[++i]);
    else if (a === "--limit") f.limit = Number(argv[++i]);
    else f._.push(a);
  }
  return f;
}

function out(line = ""): void {
  console.log(line);
}

function emit(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function consentGlyph(state: string): string {
  switch (state) {
    case "approved":
    case "limited":
      return GLYPH.approved;
    case "proposed":
      return GLYPH.proposed;
    case "revoked":
    case "deleted":
      return GLYPH.revoked;
    case "quarantined":
      return GLYPH.quarantined;
    default:
      return GLYPH.legacy;
  }
}

// ── Commands ───────────────────────────────────────────────────────────────

function cmdStatus(store: Store, f: Flags): void {
  const repo = new ContextRepository(adaptStoreForContext(store), store.workspaceId);
  const inspector = new ContextInspection(repo, store.workspaceId);
  const mem = new MemoryStore(store);
  const health = inspector.health();
  const consent = mem.consentSummary();
  const { config } = loadConfig();

  if (f.json) {
    return emit({
      enabled: isKnowledgeEnabled(),
      policyVersion: CONTEXT_POLICY_VERSION,
      workspace: store.workspaceId,
      injectionMode: config.knowledge.injectionMode,
      enforceScope: config.knowledge.enforceScope,
      lexicalOnly: config.knowledge.lexicalOnly,
      context: health,
      memory: { total: mem.count(), consent },
      bounds: CONTEXT_BOUNDS,
    });
  }

  out(C.bold("XR Knowledge and Context OS"));
  out(`  policy            ${CONTEXT_POLICY_VERSION}`);
  out(`  workspace         ${store.workspaceId}`);
  out(`  enabled           ${isKnowledgeEnabled() ? "yes" : "no"}`);
  out(`  injection mode    ${config.knowledge.injectionMode}`);
  out(`  scope enforcement ${config.knowledge.enforceScope ? "on" : C.red("OFF (unsafe)")}`);
  out(`  retrieval         ${config.knowledge.lexicalOnly ? "lexical only" : "semantic + rerank"}`);
  out("");
  out(C.bold("Context items"));
  out(`  total             ${health.total}`);
  for (const t of health.byType) out(`    ${t.type.padEnd(14)} ${t.c}`);
  if (health.quarantined) out(`  ${GLYPH.quarantined} quarantined    ${health.quarantined} (awaiting review)`);
  if (health.staleIndex) out(`  stale index       ${health.staleIndex} (will re-embed on next use)`);
  out("");
  out(C.bold("User memory consent"));
  const total = Object.values(consent).reduce((a, b) => a + b, 0);
  const active = mem.list().length;
  out(`  total             ${total} (${active} in active use)`);
  for (const [state, n] of Object.entries(consent).sort((a, b) => b[1] - a[1])) {
    out(`    ${consentGlyph(state)} ${state.padEnd(16)} ${n}`);
  }
  const superseded = mem.superseded().length;
  if (superseded) {
    out(`    ${GLYPH.stale} superseded       ${superseded} (kept for correction history)`);
  }
  if (consent.legacy_unknown) {
    out("");
    out(
      C.yellow(
        `  ${consent.legacy_unknown} entr${consent.legacy_unknown === 1 ? "y" : "ies"} predate XR 4.5. XR cannot reconstruct how consent`,
      ),
    );
    out(C.yellow("  was given, so it is recorded as unknown rather than assumed approved."));
    out(C.dim("  Review them with:  xr context legacy"));
  }
  if (consent.proposed) {
    out("");
    out(C.yellow(`  ${consent.proposed} entr${consent.proposed === 1 ? "y" : "ies"} await your decision:  xr context pending`));
  }
}

function cmdList(store: Store, f: Flags): void {
  const repo = new ContextRepository(adaptStoreForContext(store), store.workspaceId);
  const inspector = new ContextInspection(repo, store.workspaceId);
  const items = inspector.list({
    type: f.type as never,
    projectScope: f.scope,
    includeRevoked: f.all,
    limit: f.limit ?? 50,
  });

  if (f.json) return emit({ count: items.length, items });

  if (!items.length) {
    out(C.dim("No context items. XR only records what you ask it to."));
    return;
  }
  out(C.bold(`${items.length} context item(s)`));
  for (const i of items) {
    out("");
    out(`  ${consentGlyph(i.consent.state)} ${C.bold(i.id)}  ${C.dim(i.type)}`);
    out(`     ${i.title}`);
    out(
      C.dim(
        `     trust ${i.trust.status} · ${i.freshness.label} · scope ${i.scope.project} · consent ${i.consent.state}`,
      ),
    );
    if (i.lifecycle.supersededBy) out(C.dim(`     superseded by ${i.lifecycle.supersededBy}`));
  }
  out("");
  out(C.dim("Full provenance:  xr context inspect <id>"));
}

function cmdInspect(store: Store, f: Flags): void {
  const id = f._[0];
  if (!id) {
    out(C.red("usage: xr context inspect <id>"));
    return;
  }
  const repo = new ContextRepository(adaptStoreForContext(store), store.workspaceId);
  const inspector = new ContextInspection(repo, store.workspaceId);
  let view = inspector.inspect(id);

  // Fall back to user memory so one command inspects both stores.
  if (!view) {
    const mem = new MemoryStore(store);
    const entry = mem.get(id);
    if (!entry) {
      out(C.red(`no context item or memory entry: ${id}`));
      return;
    }
    if (f.json) return emit({ source: "user_memory", entry });
    out(C.bold(`Memory entry ${entry.id}`));
    out(`  content        ${entry.content}`);
    out(`  category       ${entry.category}`);
    out(`  scope          ${entry.scope}`);
    out(`  source         ${entry.source}`);
    out(`  consent        ${consentGlyph(entry.consentState ?? "legacy_unknown")} ${entry.consentState ?? "legacy_unknown"}`);
    out(`  trust          ${entry.trustStatus ?? "unknown"}`);
    out(`  provenance     ${entry.provenanceKind ?? "unknown"}${entry.provenanceRef ? ` · ${entry.provenanceRef}` : ""}`);
    out(`  created        ${new Date(entry.createdAt).toISOString()}`);
    out(`  updated        ${new Date(entry.updatedAt).toISOString()}`);
    out(`  accessed       ${entry.accessCount ?? 0} time(s)`);
    if (entry.revokedAt) out(C.yellow(`  revoked        ${new Date(entry.revokedAt).toISOString()} — ${entry.revokedReason}`));
    if (entry.supersededBy) out(C.yellow(`  superseded by  ${entry.supersededBy}`));
    if (entry.consentState === "legacy_unknown") {
      out("");
      out(C.yellow("  This entry predates XR 4.5. XR does not know how consent was given,"));
      out(C.yellow("  so it is labelled unknown rather than assumed approved."));
    }
    return;
  }

  if (f.json) return emit(view);

  out(C.bold(`Context item ${view.id}`) + C.dim(`  v${view.version}`));
  out("");
  out(C.bold("  What"));
  out(`    type         ${view.type}`);
  out(`    title        ${view.title}`);
  out(`    content      ${view.content.slice(0, 400)}${view.content.length > 400 ? "…" : ""}`);
  out("");
  out(C.bold("  Trust and authority"));
  out(`    status       ${view.trust.status}`);
  out(`    meaning      ${view.trust.label}`);
  out(`    may instruct ${view.trust.mayInstruct ? C.yellow("YES") : "no — reference data only"}`);
  out("");
  out(C.bold("  Consent"));
  out(`    state        ${consentGlyph(view.consent.state)} ${view.consent.state}`);
  out(`    actor        ${view.consent.actor ?? "—"}`);
  out(`    at           ${view.consent.at ? new Date(view.consent.at).toISOString() : "—"}`);
  out(C.dim(`    ${view.consent.explanation}`));
  out("");
  out(C.bold("  Provenance"));
  out(`    kind         ${view.provenance.kind}`);
  out(`    actor        ${view.provenance.actor}`);
  out(`    primary ref  ${view.provenance.primaryRef ?? "—"}`);
  if (view.provenance.references.length) {
    out(`    references:`);
    for (const r of view.provenance.references) {
      out(`      · ${r.kind}: ${r.label ?? r.ref}${r.observedAt ? C.dim(` (observed ${new Date(r.observedAt).toISOString().slice(0, 10)})`) : ""}`);
    }
  } else {
    out(C.dim("    no source references recorded — XR does not invent them"));
  }
  out("");
  out(C.bold("  Freshness"));
  out(`    label        ${view.freshness.label}`);
  out(`    reason       ${view.freshness.reason}`);
  out(`    created      ${new Date(view.freshness.createdAt).toISOString()}`);
  out(`    expires      ${view.freshness.expiresAt ? new Date(view.freshness.expiresAt).toISOString() : "never"}`);
  out("");
  out(C.bold("  Confidence and uncertainty"));
  out(`    confidence   ${view.confidence.level} ${C.dim("(support level, NOT a truth claim)")}`);
  out(`    confirmed    ${view.confidence.userConfirmed ? "yes, by you" : "not confirmed"}`);
  if (view.confidence.contradictedBy.length) {
    out(C.yellow(`    contradicted by: ${view.confidence.contradictedBy.join(", ")}`));
  }
  for (const q of view.confidence.openQuestions) out(`    open question: ${q}`);
  out("");
  out(C.bold("  Scope and lifecycle"));
  out(`    workspace    ${view.scope.workspace}`);
  out(`    project      ${view.scope.project}`);
  out(`    sensitivity  ${view.sensitivity}`);
  out(`    retention    ${view.retention}`);
  out(`    index        ${view.index.state}${view.index.model ? ` (${view.index.model})` : ""}`);
  out(`    used         ${view.usage.accessCount} time(s)`);
  if (view.lifecycle.revokedAt) {
    out(C.yellow(`    revoked      ${new Date(view.lifecycle.revokedAt).toISOString()} — ${view.lifecycle.revokedReason}`));
  }
  if (view.lifecycle.supersededBy) out(C.yellow(`    superseded   by ${view.lifecycle.supersededBy}`));
}

function cmdPending(store: Store, f: Flags): void {
  const mem = new MemoryStore(store);
  const { proposed, quarantined } = mem.pending();

  if (f.json) return emit({ proposed, quarantined });

  if (!proposed.length && !quarantined.length) {
    out(C.green("Nothing is waiting for your decision."));
    return;
  }
  if (proposed.length) {
    out(C.bold(`${proposed.length} item(s) proposed — XR will NOT use these until you approve`));
    for (const e of proposed) {
      out(`  ${GLYPH.proposed} ${C.bold(e.id)}  ${e.content.slice(0, 90)}`);
      out(C.dim(`      from ${e.provenanceKind ?? e.source}${e.actorName ? ` (${e.actorName})` : ""} · scope ${e.scope}`));
    }
    out("");
    out(C.dim("  Approve:  xr context approve <id>       Reject:  xr memory remove <id>"));
  }
  if (quarantined.length) {
    out("");
    out(C.yellow(`${quarantined.length} item(s) quarantined — a safety signature matched`));
    for (const e of quarantined) {
      out(`  ${GLYPH.quarantined} ${C.bold(e.id)}  ${e.content.slice(0, 90)}`);
    }
    out("");
    out(C.dim("  These are never retrieved. Review, then delete or release explicitly."));
  }
}

function cmdLegacy(store: Store, f: Flags): void {
  const mem = new MemoryStore(store);
  const legacy = mem.legacyUnknown();
  if (f.json) return emit({ count: legacy.length, entries: legacy });

  if (!legacy.length) {
    out(C.green("No legacy entries — every record has an explicit consent state."));
    return;
  }
  out(C.bold(`${legacy.length} entr${legacy.length === 1 ? "y" : "ies"} created before XR 4.5`));
  out(C.dim("XR cannot reconstruct how consent was given for these, so it records"));
  out(C.dim("'unknown' rather than assuming approval. They are still used for recall"));
  out(C.dim("and are flagged as legacy wherever they appear."));
  out("");
  for (const e of legacy) {
    out(`  ${GLYPH.legacy} ${C.bold(e.id)}  ${e.content.slice(0, 90)}`);
    out(C.dim(`      ${e.category} · scope ${e.scope} · source ${e.source} · ${new Date(e.createdAt).toISOString().slice(0, 10)}`));
  }
  out("");
  out(C.dim("  Affirm:  xr context approve <id>        Revoke:  xr context revoke <id>"));
}

function cmdApprove(store: Store, f: Flags): void {
  const id = f._[0];
  if (!id) {
    out(C.red("usage: xr context approve <id>"));
    return;
  }
  const mem = new MemoryStore(store);
  const res = mem.approveConsent(id, "user");
  if (f.json) return emit(res);
  out(res.ok ? C.green(`Approved ${id}. XR may now use it.`) : C.red(`Could not approve: ${res.reason}`));
}

function cmdRevoke(store: Store, f: Flags): void {
  const id = f._[0];
  if (!id) {
    out(C.red("usage: xr context revoke <id> [--reason <text>]"));
    return;
  }
  const mem = new MemoryStore(store);
  const res = mem.revoke(id, f.reason ?? "user_revoked", "user");
  if (f.json) return emit({ ...res, residual: res.ok ? residualDisclosure() : [] });
  if (!res.ok) {
    out(C.red(`Could not revoke: ${res.reason}`));
    return;
  }
  out(C.green(`Revoked ${id}.`));
  out("  XR will not retrieve it again, and its cached embedding was destroyed.");
  out("");
  out(C.bold("  What this does and does not remove:"));
  for (const line of residualDisclosure()) out(C.dim(`    · ${line}`));
}

function cmdCorrect(store: Store, f: Flags): void {
  const [id, ...rest] = f._;
  const replacement = rest.join(" ").trim();
  if (!id || !replacement) {
    out(C.red('usage: xr context correct <id> "<corrected text>"'));
    return;
  }
  const mem = new MemoryStore(store);
  const res = mem.correct(id, replacement, "user");
  if (f.json) return emit(res);
  if (!res.ok) {
    out(C.red(`Could not correct: ${res.reason}`));
    return;
  }
  out(C.green(`Corrected. New entry ${res.newId}.`));
  out(C.dim(`  ${id} is kept and marked superseded, so the correction history survives.`));
  out(C.dim("  A superseded entry can never outrank its correction in retrieval."));
}

function cmdExplain(store: Store, f: Flags): void {
  const id = f._[0];
  const repo = new ContextRepository(adaptStoreForContext(store), store.workspaceId);

  if (!id) {
    // Explain the policy itself when no id is given.
    if (f.json) {
      return emit({
        policyVersion: CONTEXT_POLICY_VERSION,
        tiers: CONTEXT_TIERS.map((t) => TIER_POLICIES[t]),
        actorCeilings: {
          user: tierCeilingFor("user"),
          agent: tierCeilingFor("agent"),
          plugin: tierCeilingFor("plugin"),
          mcp: tierCeilingFor("mcp"),
          model: tierCeilingFor("model"),
        },
        agentRoleTiers: {
          none: tiersForMemoryScopeKind("none"),
          workflow: tiersForMemoryScopeKind("workflow"),
          project: tiersForMemoryScopeKind("project"),
          research: tiersForMemoryScopeKind("research"),
          user: tiersForMemoryScopeKind("user"),
        },
      });
    }
    out(C.bold("Context tiers and what each may do"));
    out("");
    for (const tier of CONTEXT_TIERS) {
      const p = TIER_POLICIES[tier];
      out(`  ${C.bold(tier.padEnd(18))} ${p.mayInstruct ? C.yellow("may instruct") : "data only"}`);
      out(C.dim(`    types      ${p.allowedTypes.join(", ")}`));
      out(C.dim(`    max trust  ${p.maxTrust}`));
      out(C.dim(`    bounds     ${p.maxItems} items / ${p.maxChars} chars · ${p.compressible ? "compressible" : "never compressed"}`));
    }
    out("");
    out(C.bold("Who may see which tiers"));
    for (const kind of ["user", "agent", "plugin", "mcp", "model"] as const) {
      out(`  ${kind.padEnd(8)} ${tierCeilingFor(kind).join(", ") || C.dim("(nothing)")}`);
    }
    out("");
    out(C.dim("Only the 'instructions' tier can direct behavior, and only for items"));
    out(C.dim("whose trust is 'trusted_instruction'. Retrieval can never move an item there."));
    return;
  }

  const prov = new ProvenanceService(repo);
  const citation = prov.citation(id);
  const refs = prov.references(id);
  if (f.json) return emit({ id, citation, references: refs });
  out(C.bold(`Provenance for ${id}`));
  out(`  citation   ${citation ?? C.dim("none recorded")}`);
  for (const r of refs) out(`  · ${r.kind}: ${r.label ?? r.ref}`);
  if (!refs.length) out(C.dim("  No source references. XR does not fabricate provenance."));
}

function cmdExport(store: Store, f: Flags): void {
  const repo = new ContextRepository(adaptStoreForContext(store), store.workspaceId);
  const inspector = new ContextInspection(repo, store.workspaceId);
  const mem = new MemoryStore(store);
  const bundle = {
    ...inspector.export(),
    memory: mem.export(),
  };
  const target = f._[0];
  if (target) {
    // Lazy import so the CLI stays fast when no file is written.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(target, JSON.stringify(bundle, null, 2), "utf8");
    out(C.green(`Exported to ${target}`));
    out(C.dim(`  ${bundle.items.length} context item(s), ${bundle.memory.entries.length} memory entr(ies), ${bundle.revocations.length} revocation record(s)`));
    return;
  }
  emit(bundle);
}

function cmdPrune(store: Store, f: Flags): void {
  const repo = new ContextRepository(adaptStoreForContext(store), store.workspaceId);
  const items = repo.pruneExpired(store.workspaceId);
  const packages = repo.prunePackages();
  if (f.json) return emit({ items, packages });
  out(C.green(`Pruned ${items} expired item(s) and ${packages} old context package(s).`));
}

function printHelp(): void {
  out(`${C.bold("xr context")} — inspect and control what XR knows

${C.bold("Inspect")}
  xr context                       status: counts, consent, policy
  xr context list [--type t] [--scope s] [--all] [--json]
  xr context inspect <id>          full provenance, trust, consent, freshness
  xr context explain               how tiers, trust, and authority work
  xr context explain <id>          citations for one item
  xr context pending               items awaiting your decision
  xr context legacy                pre-4.5 entries with unknown consent

${C.bold("Control")}
  xr context approve <id>          grant consent (the only way to reach "approved")
  xr context revoke <id> [--reason t]   withdraw consent; keeps the record
  xr context correct <id> "<text>"      replace, preserving correction lineage
  xr context forget <id> -y        hide from retrieval (undoable, never silent)
  xr context conflicts             list contradictions/staleness + status
  xr context resolve <a> <b> --keep a|b|stale|both -y   decide a conflict
  xr context undo [opId]           undo the latest (or given) context op
  xr context history               the ops ledger (what changed, when, by whom)
  xr context promote               fold stale task context into summaries
  xr context benchmark [--write] [--json]   measured recall (offline)
  xr context export [path]         export everything XR holds
  xr context prune                 delete expired items and old packages

${C.bold("The rule")}
  ${C.dim("Memory is context, not authority. A retrieved item never becomes an")}
  ${C.dim("instruction just because it was stored or ranked highly.")}

${C.bold("Related")}
  xr memory …                      the durable memory surface
  xr context explain               tier and authority reference`);
}

// ── Entry point ────────────────────────────────────────────────────────────

export async function handleContextCommand(argv: string[], store: Store): Promise<void> {
  const sub = argv[0];
  const flags = parseFlags(argv.slice(1));
  if (flags.scope === ".") flags.scope = projectScopeFromCwd(process.cwd());

  if (!sub || sub === "status") return cmdStatus(store, flags);
  if (sub === "help" || sub === "--help" || sub === "-h") return printHelp();
  if (sub === "list" || sub === "ls") return cmdList(store, flags);
  if (sub === "inspect" || sub === "show") return cmdInspect(store, flags);
  if (sub === "pending") return cmdPending(store, flags);
  if (sub === "legacy") return cmdLegacy(store, flags);
  if (sub === "approve") return cmdApprove(store, flags);
  if (sub === "revoke") return cmdRevoke(store, flags);
  if (sub === "correct") return cmdCorrect(store, flags);
  if (sub === "explain" || sub === "why") return cmdExplain(store, flags);
  if (sub === "export") return cmdExport(store, flags);
  if (sub === "prune") return cmdPrune(store, flags);

  // Phase 6 · T1/T4/T5/T6 — delegated to the Phase 6 module (keeps this file
  // under the module size budget).
  const { handlePhase6ContextCommand } = await import("./cli-phase6.ts");
  if (await handlePhase6ContextCommand(sub!, flags, store)) return;

  out(C.red(`unknown context subcommand: ${sub}`));
  printHelp();
}
