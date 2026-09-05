/**
 * XR Phase 7 (F-21) — `xr memory` policy-layer subcommands.
 *
 *   xr memory conflicts [--all] [--json]            open contradiction rows
 *   xr memory resolve <a> <b> --keep a|b|both [-y]  supersede the loser (kept, never deleted)
 *   xr memory consolidate [--dry-run] [--days N] [--max-importance n] [--scope s] [--max-tokens n] [-y]
 *   xr memory forget <id> | --query "<text>" | --scope <s>  [-y]   IRREVERSIBLE (see docs/privacy/MEMORY.md)
 *   xr memory export [path] [--md] [--scope s] [--include-quarantined] [--no-redact]
 *
 * Wired from `handleMemoryCommand` (cli.ts). Every destructive action asks
 * unless `-y`; every action is audited by the modules it calls.
 */

import { writeFileSync } from "node:fs";
import type { Store } from "../../state/workspace-store.ts";
import { banner, ok, warn, info, confirm, colors as C } from "../../interfaces/cli.ts";
import type { MemoryStore } from "./store.ts";
import { getConflict, listConflicts, markConflictResolved } from "./provenance.ts";
import { applyConsolidation, planConsolidation } from "./consolidate.ts";
import { exportBundle, forgetMemory, planForget, renderMarkdown, type ForgetTarget } from "./forget-export.ts";

export interface Phase7Flags {
  scope?: string;
  json: boolean;
  yes: boolean;
  dryRun: boolean;
  days?: number;
  maxImportance?: number;
  rest: string[];
  /** Phase 7 additions (parsed here from `rest` so cli.ts's parser stays untouched). */
  md?: boolean;
  keep?: "a" | "b" | "both";
  query?: string;
  all?: boolean;
  includeQuarantined?: boolean;
  noRedact?: boolean;
  maxTokens?: number;
}

/** Pull Phase 7 flags out of the leftover args (cli.ts's parser only knows the shared flags). */
export function parsePhase7(f: Phase7Flags): Phase7Flags {
  const rest: string[] = [];
  for (let i = 0; i < f.rest.length; i++) {
    const a = f.rest[i]!;
    if (a === "--md") f.md = true;
    else if (a === "--all") f.all = true;
    else if (a === "--include-quarantined") f.includeQuarantined = true;
    else if (a === "--no-redact") f.noRedact = true;
    else if (a === "--keep") {
      const k = f.rest[++i];
      if (k === "a" || k === "b" || k === "both") f.keep = k;
      else warn(`--keep must be a|b|both (got "${k}")`);
    } else if (a === "--query" || a === "-q") f.query = f.rest[++i];
    else if (a === "--max-tokens") f.maxTokens = Number(f.rest[++i]);
    else rest.push(a);
  }
  f.rest = rest;
  return f;
}

// ── conflicts / resolve ─────────────────────────────────────────────────────

export function cmdConflicts(store: Store, mem: MemoryStore, f: Phase7Flags): void {
  const rows = listConflicts(store, { status: f.all ? "all" : "open", limit: 200 });
  if (f.json) return void console.log(JSON.stringify(rows, null, 2));
  banner();
  console.log(C.bold(`⚖  Memory conflicts (${rows.length}${f.all ? "" : " open"})`));
  if (!rows.length) return void info("no contradictions recorded.");
  for (const r of rows) {
    const a = mem.get(r.item_a);
    const b = mem.get(r.item_b);
    const st = r.status === "open" ? C.yellow("OPEN") : C.green(`resolved: ${r.resolution} by ${r.resolved_by}`);
    console.log(`  ${C.dim(r.id)}  ${Math.round(r.similarity * 100)}% similar  ${st}`);
    console.log(`      a ${C.dim(r.item_a)} ${a ? a.content.slice(0, 100) : C.dim("(gone)")}`);
    console.log(`      b ${C.dim(r.item_b)} ${b ? b.content.slice(0, 100) : C.dim("(gone)")}`);
  }
  console.log(C.dim("\n  Resolve: xr memory resolve <a> <b> --keep a|b|both -y   (the loser is superseded, never deleted)"));
}

export async function cmdResolve(store: Store, mem: MemoryStore, f: Phase7Flags): Promise<void> {
  const [a, b] = f.rest;
  if (!a || !b || !f.keep) {
    warn("usage: xr memory resolve <idA> <idB> --keep a|b|both [-y]");
    return;
  }
  const A = mem.get(a);
  const B = mem.get(b);
  if (!A || !B) return void warn(`not found: ${!A ? a : b}`);
  const conflict = listConflicts(store, { status: "open", limit: 500 }).find(
    (c) => (c.item_a === A.id && c.item_b === B.id) || (c.item_a === B.id && c.item_b === A.id),
  );
  const yes = f.yes || (await confirm(`Resolve ${A.id} vs ${B.id} keeping ${f.keep}? The loser stays in history as superseded.`, false));
  if (!yes) return void info("cancelled.");
  const { runMemoryOpWithLedger } = await import("../cli-phase6.ts");
  if (f.keep !== "both") {
    const winner = f.keep === "a" ? A : B;
    const loser = f.keep === "a" ? B : A;
    // Undoable through the ops ledger (the before-image of the loser is kept).
    const okSup = runMemoryOpWithLedger(store, "memory_correct", loser.id, "user", () => store.supersedeMemory(loser.id, winner.id));
    if (!okSup) return void warn("could not record the supersession");
  }
  if (conflict) markConflictResolved(store, conflict.id, `keep_${f.keep}`, "user");
  store.audit("memory.resolve", { a: A.id, b: B.id, keep: f.keep, conflictId: conflict?.id ?? null, actor: "user" });
  ok(f.keep === "both" ? `kept both (conflict ${conflict ? "closed" : "not on record"})` : `kept ${f.keep === "a" ? A.id : B.id}; ${f.keep === "a" ? B.id : A.id} superseded (undo: xr memory undo)`);
}

// ── consolidate ─────────────────────────────────────────────────────────────

export async function cmdConsolidate(store: Store, mem: MemoryStore, f: Phase7Flags): Promise<void> {
  const opts = {
    olderThanDays: Number.isFinite(f.days) ? f.days : undefined,
    maxImportance: Number.isFinite(f.maxImportance) ? f.maxImportance : undefined,
    scope: f.scope,
    ...(Number.isFinite(f.maxTokens) && (f.maxTokens as number) > 0 ? { budget: { maxTokens: f.maxTokens as number } } : {}),
  };
  const plan = planConsolidation(mem, opts);
  if (f.json && f.dryRun) return void console.log(JSON.stringify(plan, null, 2));
  banner();
  console.log(C.bold("🧠 Memory consolidation (supersedes — never deletes originals)"));
  if (!plan.groups.length) {
    info(plan.alreadyConsolidated ? `nothing new to consolidate (${plan.alreadyConsolidated} group(s) already have a summary).` : "nothing eligible — no group of old, low-importance notes found.");
    return;
  }
  for (const g of plan.groups) {
    console.log(`  ${C.cyan(g.category.padEnd(10))} ${C.dim(`[${g.scope}]`)} ${g.originals.length} notes → 1 summary${g.visibility.includes("*") ? "" : C.dim(` (visible to: ${g.visibility.join(",")})`)}`);
    console.log(`      ${C.dim(g.summary.slice(0, 160))}${g.summary.length > 160 ? C.dim("…") : ""}`);
  }
  if (f.dryRun) return void info("dry run — nothing changed.");
  const yes = f.yes || (await confirm(`Consolidate ${plan.totalOriginals} notes into ${plan.groups.length} summary(ies)? Originals are kept (superseded, inspectable, exportable).`, false));
  if (!yes) return void info("cancelled.");
  const res = await applyConsolidation(store, mem, plan, opts);
  if (f.json) return void console.log(JSON.stringify(res, null, 2));
  ok(`created ${res.created} summary(ies) · superseded ${res.superseded} note(s) · ${res.usage.inTokens + res.usage.outTokens} tok metered ($${res.usage.usd.toFixed(4)})`);
  if (res.budgetStopped) warn(`budget ceiling reached — ${res.skipped} group(s) left untouched. Re-run with a higher --max-tokens to continue${res.created === 0 ? " (the ceiling is below the governor's first-step estimate of ~2,000 tokens, so nothing ran)" : ""}.`);
  else if (res.skipped) warn(`${res.skipped} group(s) skipped (summary could not be stored); their notes are intact.`);
}

// ── forget (irreversible) ───────────────────────────────────────────────────

export async function cmdForget(store: Store, mem: MemoryStore, f: Phase7Flags): Promise<void> {
  let target: ForgetTarget | null = null;
  if (f.query) target = { kind: "query", query: f.query };
  else if (f.rest[0]) target = { kind: "id", id: f.rest[0] };
  else if (f.scope) target = { kind: "scope", scope: f.scope };
  if (!target) {
    warn('usage: xr memory forget <id> | --query "<text>" | --scope <s>   [-y]   (irreversible; `xr memory remove` is the undoable delete)');
    return;
  }
  const victims = planForget(mem, target);
  if (!victims.length) return void warn("nothing matched — nothing forgotten.");
  if (!f.json) {
    banner();
    console.log(C.bold(`🔥 Forget ${victims.length} entr${victims.length === 1 ? "y" : "ies"} — ${C.red("IRREVERSIBLE")}`));
    for (const v of victims.slice(0, 25)) console.log(`  ${C.dim(v.id)} ${v.content.slice(0, 100)}`);
    if (victims.length > 25) console.log(C.dim(`  … and ${victims.length - 25} more`));
    info("this also purges cached vectors and ledger before-images; `xr memory undo` will NOT bring them back.");
  }
  const yes = f.yes || (await confirm(`Permanently forget ${victims.length} entr${victims.length === 1 ? "y" : "ies"}?`, false));
  if (!yes) return void info("cancelled.");
  const res = forgetMemory(store, mem, target, "user");
  if (f.json) return void console.log(JSON.stringify(res, null, 2));
  if (res.ok) ok(`forgotten ${res.forgotten.length} entr${res.forgotten.length === 1 ? "y" : "ies"} (audit: memory.forgotten · ${res.purgedLedgerRows} ledger image(s) purged)`);
  else warn(`forget failed: ${res.reason ?? "unknown"}`);
}

// ── export (--json default | --md) ──────────────────────────────────────────

export function cmdExport(mem: MemoryStore, f: Phase7Flags): void {
  const bundle = exportBundle(mem, { scope: f.scope, includeQuarantined: f.includeQuarantined, redact: !f.noRedact });
  const body = f.md ? renderMarkdown(bundle) : JSON.stringify(bundle, null, 2);
  const path = f.rest[0];
  if (!path) return void console.log(body);
  writeFileSync(path, body);
  ok(`exported ${bundle.entries.length} entr${bundle.entries.length === 1 ? "y" : "ies"} → ${path}${bundle.labelled ? ` · ${bundle.labelled} labelled quarantined/revoked` : ""}${bundle.redacted ? ` · ${bundle.redacted} secret(s) masked` : ""}`);
}

export const PHASE7_HELP = `
${C.bold("Policy (Phase 7)")}
  xr memory conflicts [--all] [--json]   contradictions recorded at write time
  xr memory resolve <a> <b> --keep a|b|both [-y]   the loser is superseded (kept), never deleted
  xr memory consolidate [--dry-run] [--days N] [--max-importance n] [--scope s] [--max-tokens n] [-y]
                                     fold old, low-importance notes into cited summaries;
                                     originals are SUPERSEDED, never destroyed; budgeted; idempotent
  xr memory forget <id> | --query "<text>" | --scope <s>  [-y]
                                     IRREVERSIBLE erase (vectors + ledger images purged; audited)
  xr memory export [path] [--md] [--scope s] [--include-quarantined] [--no-redact]
                                     JSON (v2) or Markdown; quarantined rows are labelled, secrets masked
  xr memory add … --visible-to <role>[,<role>]   sequester a note to specific agent roles
  ${C.dim("Privacy contract: docs/privacy/MEMORY.md")}`;
