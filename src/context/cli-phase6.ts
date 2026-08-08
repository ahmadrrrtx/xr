/**
 * XR 4.6 — Phase 6 · T1/T4/T5/T6: `xr context` surfaces for the new quality
 * machinery: conflicts, resolve, forget, promote, undo, history, benchmark.
 *
 * Kept in its own module so `cli.ts` stays under the module size budget; the
 * main handler delegates here when a Phase 6 subcommand is used. Everything
 * works over the ONE context store (ContextRepository over the workspace
 * store) — no store is opened here.
 */

import { ContextRepository, adaptStoreForContext } from "./repository.ts";
import { ProgressiveLifecycle } from "./lifecycle.ts";
import { ConflictResolver, type ResolutionKind } from "./conflicts.ts";
import { UndoLedger, type LedgerOp } from "./undo.ts";
import { runRecallBenchmark, evaluateTargets, type DomainFixture } from "./eval/harness.ts";
import { LEXICAL_ROUTE } from "./embedding.ts";
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import type { Store } from "../state/workspace-store.ts";

function out(line = ""): void {
  console.log(line);
}

const C = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

export interface Phase6Flags {
  json?: boolean;
  scope?: string;
  yes?: boolean;
  keep?: string;
  limit?: number;
  reason?: string;
  write?: boolean;
  olderThanDays?: number;
  _: string[];
}

function repoFor(store: Store): { repo: ContextRepository; wsId: string } {
  const wsId = store.workspaceId ?? "default";
  const repo = new ContextRepository(adaptStoreForContext(store), wsId);
  repo.migrate();
  return { repo, wsId };
}

// ── conflicts ───────────────────────────────────────────────────────────────

function cmdConflicts(store: Store, flags: Phase6Flags): void {
  const { repo, wsId } = repoFor(store);
  const resolver = new ConflictResolver(repo, wsId);
  const candidates = repo.scopeCandidates(wsId, {
    projectScope: flags.scope,
    limit: 500,
  });
  const open = resolver.openConflicts(candidates);
  const limit = flags.limit ?? 25;

  if (flags.json) {
    out(JSON.stringify(open.slice(0, limit).map(({ finding, resolution }) => ({ finding, resolution: resolution ?? null })), null, 2));
    return;
  }
  out(C.bold(`Context conflicts — ${open.length} detected`));
  if (open.length === 0) {
    out(C.green("  no contradictions or staleness conflicts in scope"));
    return;
  }
  for (const { finding, resolution } of open.slice(0, limit)) {
    const status = resolution ? C.green(`resolved by ${resolution.decided_by}: ${resolution.resolution}`) : C.yellow("OPEN");
    out(`  ${finding.itemId} ${C.dim("⟷")} ${finding.otherId}  ${finding.kind}  ${status}`);
    out(`    ${C.dim(finding.detail)}`);
  }
  if (!flags.json) out(C.dim("\n  Resolve: xr context resolve <idA> <idB> --keep a|b|stale|both"));
}

// ── resolve ─────────────────────────────────────────────────────────────────

function cmdResolve(store: Store, flags: Phase6Flags): void {
  const [a, b] = flags._;
  if (!a || !b) {
    out(C.red("usage: xr context resolve <idA> <idB> --keep a|b|stale|both [--reason <text>]"));
    return;
  }
  const keepFlag = (flags.keep ?? "").toLowerCase();
  const kind: ResolutionKind | null =
    keepFlag === "a" ? "keep_a" : keepFlag === "b" ? "keep_b" : keepFlag === "stale" ? "stale" : keepFlag === "both" ? "both" : null;
  if (!kind) {
    out(C.red("--keep must be one of: a, b, stale, both"));
    return;
  }
  // Confirmation for destructive precedence decisions (Article X.3).
  if (!flags.yes) {
    out(C.red(`Refusing without -y. This will mark the losing item superseded (kept, never deleted). Re-run with: xr context resolve ${a} ${b} --keep ${keepFlag} -y`));
    return;
  }

  const { repo, wsId } = repoFor(store);
  const resolver = new ConflictResolver(repo, wsId);
  const ledger = new UndoLedger(repo, wsId);
  const itemA = repo.getItem(a);
  const itemB = repo.getItem(b);
  if (!itemA || !itemB) {
    out(C.red(!itemA ? `item not found: ${a}` : `item not found: ${b}`));
    return;
  }

  const result = resolver.resolve(itemA, itemB, kind, {
    decidedBy: "user",
    reason: flags.reason ?? `manual resolution ${a} ${kind}`,
    recordUndo: (loser) => {
      const opId = ledger.begin("resolve", "context_items", loser.id, { actor: "user", reason: flags.reason });
      queueMicrotask(() => ledger.finalize(opId, "context_items", loser.id));
      return opId;
    },
  });

  if (flags.json) {
    out(JSON.stringify(result, null, 2));
    return;
  }
  if (!result.ok) {
    out(C.red(`resolution failed: ${result.reason}`));
    return;
  }
  out(C.green(`resolved: ${result.resolution}${result.loserId ? ` — ${result.loserId} is now superseded (kept for history)` : " — both stay retrievable"}`));
  out(C.dim(`  resolution id ${result.resolutionId} · undo with: xr context undo`));
}

// ── forget ──────────────────────────────────────────────────────────────────

function cmdForget(store: Store, flags: Phase6Flags): void {
  const id = flags._[0];
  if (!id) {
    out(C.red("usage: xr context forget <id> [--reason <text>]"));
    return;
  }
  const { repo, wsId } = repoFor(store);
  const item = repo.getItem(id);
  if (!item) {
    out(C.red(`item not found: ${id}`));
    return;
  }
  if (!flags.yes) {
    out(C.red(`Refusing without -y. This hides the item from retrieval until pruned. It is NOT deleted and can be undone. Re-run with: xr context forget ${id} -y`));
    return;
  }
  const resolver = new ConflictResolver(repo, wsId);
  const ledger = new UndoLedger(repo, wsId);
  const out_ = resolver.forget(item, {
    actor: "user",
    reason: flags.reason ?? "user_forget",
    recordUndo: (i) => {
      const opId = ledger.begin("forget", "context_items", i.id, { actor: "user", reason: flags.reason });
      queueMicrotask(() => ledger.finalize(opId, "context_items", i.id));
      return opId;
    },
  });
  if (flags.json) {
    out(JSON.stringify(out_, null, 2));
    return;
  }
  if (!out_.ok) {
    out(C.red(`forget failed: ${out_.reason}`));
    return;
  }
  out(C.green(`forgotten: ${id} (hidden from retrieval; undo with: xr context undo)`));
}

// ── promote ─────────────────────────────────────────────────────────────────

function cmdPromote(store: Store, flags: Phase6Flags): void {
  const { repo, wsId } = repoFor(store);
  const lifecycle = new ProgressiveLifecycle(repo, wsId);
  const projectScope = flags.scope ?? "global";
  const olderThanMs = (flags.olderThanDays ?? 14) * 86_400_000;
  const results = lifecycle.promoteStale(
    { projectScope },
    { olderThanMs, actor: "user-cli" },
  );

  if (flags.json) {
    out(JSON.stringify(results, null, 2));
    return;
  }
  if (results.length === 0) {
    out(C.green("nothing to promote (no eligible verbatim task context)"));
    return;
  }
  for (const r of results) {
    if (r.ok) {
      out(C.green(`promoted ${r.externalizedIds.length} item(s) → summary ${r.summaryId} (${r.preserved.length} invariants preserved)`));
    } else {
      out(C.yellow(`skipped ${r.skipped.map((s) => s.itemIds.length).reduce((a, b) => a + b, 0)} item(s): ${r.skipped[0]?.reason}`));
    }
  }
  out(C.dim("  Originals are NEVER deleted — they are externalized (deep retrieval: memory_search --deep)."));
}

// ── undo / history ──────────────────────────────────────────────────────────

function cmdUndo(store: Store, flags: Phase6Flags): void {
  const { repo, wsId } = repoFor(store);
  const ledger = new UndoLedger(repo, wsId);
  const opId = flags._[0];
  const target = opId ?? ledger.latestUndoable()?.id;
  if (!target) {
    out(C.green("nothing to undo"));
    return;
  }
  const result = ledger.undo(target, { actor: "user" });
  if (flags.json) {
    out(JSON.stringify(result, null, 2));
    return;
  }
  if (!result.ok) {
    out(C.red(`undo failed: ${result.reason}`));
    return;
  }
  out(C.green(`undone: ${result.undoneOpId} (restored ${result.restoredTarget?.table}/${result.restoredTarget?.id})`));
}

function cmdHistory(store: Store, flags: Phase6Flags): void {
  const { repo, wsId } = repoFor(store);
  const ledger = new UndoLedger(repo, wsId);
  const ops = ledger.history({ includeUndone: true, limit: flags.limit ?? 25 });
  if (flags.json) {
    out(JSON.stringify(ops, null, 2));
    return;
  }
  out(C.bold(`Context ops history — ${ops.length} shown`));
  for (const op of ops) {
    const state = op.undone_at ? C.dim(" (undone)") : "";
    out(`  ${op.id}  ${op.op.padEnd(16)} ${op.target_table}/${op.target_id.slice(0, 24)}  ${new Date(op.created_at).toISOString()}${state}`);
    if (op.reason) out(C.dim(`    ${op.reason}`));
  }
}

// ── benchmark ───────────────────────────────────────────────────────────────

async function cmdBenchmark(store: Store, flags: Phase6Flags): Promise<void> {
  const fixtures = loadBenchmarkFixtures();
  if (fixtures.length === 0) {
    out(C.red("no benchmark fixtures found (benchmarks/recall/*.json)"));
    return;
  }

  // The benchmark NEVER runs against the live workspace database. It owns a
  // scratch database in tmp so recall measurements can never contaminate user
  // data (Art. XXI) and are disposable by construction (offline/async).
  const scratchDir = mkdtempLike("xr-bench-");
  const scratchPath = join(scratchDir, `bench-${Date.now()}.db`);
  const { Store: ScratchStore } = await import("../state/workspace-store.ts");
  const scratch = new ScratchStore("bench", scratchPath);

  try {
    const report = await runRecallBenchmark({
      fixtures,
      db: adaptStoreForContext(scratch),
      workspaceId: "bench",
      route: LEXICAL_ROUTE, // offline mandatory baseline
      verbose: !flags.json,
    });

    const evaluation = evaluateTargets(report);
    const measured = { report, targets: evaluation };

    if (flags.write) {
      const dest = join("docs", "perf", "measured-recall.json");
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, JSON.stringify(measured, null, 2));
      out(C.dim(`  wrote ${dest}`));
    }

    if (flags.json) {
      out(JSON.stringify(measured, null, 2));
    } else {
      out(C.bold(`Recall benchmark — ${report.summary.queries} queries (route: ${report.route})`));
      out("");
      for (const [comp, m] of Object.entries(report.overall)) {
        out(`  ${comp.padEnd(26)} R@5 ${m.recallAt5.toFixed(3)}  P@1 ${m.precisionAt1.toFixed(3)}  MRR ${m.mrr.toFixed(3)}  (${m.queries} queries)`);
      }
      out("");
      out(`  ${evaluation.ok ? C.green("all recall targets met") : C.red("targets NOT met:")}`);
      for (const v of evaluation.violations) out(`    ${C.red("✗")} ${v}`);
    }
  } finally {
    scratch.close();
    try {
      rmSync(scratchDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; the benchmark artifact is disposable anyway
    }
  }
}

/** One directory per benchmark run, so runs cannot interfere. */
function mkdtempLike(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function loadBenchmarkFixtures(): DomainFixture[] {
  const base = join(process.cwd(), "benchmarks", "recall");
  const out_: DomainFixture[] = [];
  for (const name of ["code", "research", "personal", "business"]) {
    const p = join(base, `${name}.json`);
    if (!existsSync(p)) continue;
    try {
      out_.push(JSON.parse(readFileSync(p, "utf8")) as DomainFixture);
    } catch (e) {
      out(C.red(`fixture ${p} unreadable: ${e instanceof Error ? e.message : String(e)}`));
    }
  }
  return out_;
}

// ── dispatcher ─────────────────────────────────────────────────────────────

export async function handlePhase6ContextCommand(
  sub: string,
  flags: Phase6Flags,
  store: Store,
): Promise<boolean> {
  switch (sub) {
    case "conflicts":
      cmdConflicts(store, flags);
      return true;
    case "resolve":
      cmdResolve(store, flags);
      return true;
    case "forget":
      cmdForget(store, flags);
      return true;
    case "promote":
      cmdPromote(store, flags);
      return true;
    case "undo":
      cmdUndo(store, flags);
      return true;
    case "history":
      cmdHistory(store, flags);
      return true;
    case "benchmark":
    case "recall":
      await cmdBenchmark(store, flags);
      return true;
    default:
      return false;
  }
}

/** Undo wrapper for legacy memory-table ops (called from memory/cli.ts). */
export function runMemoryOpWithLedger<T>(
  store: Store,
  op: LedgerOp,
  memoryId: string,
  actor: string,
  run: () => T,
): T {
  const { repo, wsId } = repoFor(store);
  const ledger = new UndoLedger(repo, wsId);
  const opId = ledger.begin(op, "user_memory", memoryId, { actor, reason: `memory ${op} ${memoryId}` });
  try {
    return run();
  } finally {
    ledger.finalize(opId, "user_memory", memoryId);
  }
}
