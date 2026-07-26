/**
 * XR 5.1 — `xr env` command group: environment inspection and management.
 *
 * Progressive disclosure: normal output is compact; `--json` exposes the full
 * machine-readable detail (sessions, policy, capability matrix, records).
 * All output is text (screen-reader readable, non-color-dependent semantics).
 */
import type { Store } from "../state/workspace-store.ts";
import { colors as C } from "../interfaces/cli.ts";
import {
  environmentStatus,
  environmentHistory,
  environmentDisabled,
  getEnvironmentConfig,
  listEnvironmentSessions,
  closeEnvironmentSession,
  detectEnvironmentCapabilities,
} from "../environment/service.ts";
import { environmentObservations } from "../environment/observations.ts";

function json(v: unknown): void {
  console.log(JSON.stringify(v, null, 2));
}

async function cmdStatus(flags: string[]): Promise<void> {
  const status = await environmentStatus();
  if (flags.includes("--json")) return json(status);
  const caps = status.capabilities as { os: string; entries: { environment: string; support: string; missing: string[] }[] };
  const sessions = status.sessions as { sessionId: string; type: string; state: string; actionsPerformed: number }[];
  const kill = environmentDisabled();
  console.log(C.bold("🌐 Environment Interaction OS"));
  console.log(`  enabled .......... ${kill.disabled ? C.red(`✗ ${kill.reason}`) : C.green("yes")}`);
  console.log(`  platform ......... ${C.cyan(caps.os)}`);
  for (const e of caps.entries) {
    const mark = e.support === "supported" ? C.green("supported") : e.support === "partial" ? C.amber("partial") : C.red("unsupported");
    console.log(`  ${e.environment.padEnd(12)} ${mark}${e.missing.length ? C.dim(` — missing: ${e.missing[0]}`) : ""}`);
  }
  console.log(`  sessions ......... ${sessions.length} tracked`);
  for (const s of sessions) {
    console.log(`    ${s.sessionId}  ${s.type}  ${s.state}  actions:${s.actionsPerformed}`);
  }
  if (!sessions.length) console.log(C.dim("    (none — sessions appear when governed browser work runs)"));
  console.log(C.dim("  detail: xr env capabilities --json · xr env sessions --json · xr env history --json"));
}

async function cmdCapabilities(flags: string[]): Promise<void> {
  const report = await detectEnvironmentCapabilities();
  if (flags.includes("--json")) return json(report);
  console.log(C.bold("Environment capability matrix"));
  console.log(`  platform: ${report.os}`);
  for (const e of report.entries) {
    console.log(`\n  ${C.bold(e.environment)} — ${e.support}`);
    for (const w of e.working) console.log(`    works: ${w}`);
    for (const m of e.missing) console.log(`    missing: ${m}`);
    if (e.remediation) console.log(`    remedy: ${e.remediation}`);
  }
}

async function cmdSessions(flags: string[]): Promise<void> {
  const sessions = listEnvironmentSessions().map((s) => ({
    sessionId: s.sessionId,
    type: s.type,
    state: s.state,
    workspaceId: s.workspaceId,
    taskId: s.taskId,
    actionsPerformed: s.actionsPerformed,
    consecutiveFailures: s.consecutiveFailures,
    circuitOpenUntil: s.circuitOpenUntil,
    cleanupState: s.cleanupState,
    quarantineReason: s.quarantineReason,
    policy: s.policy,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    historyLength: s.history.length,
  }));
  if (flags.includes("--json")) return json({ sessions });
  if (!sessions.length) return void console.log(C.dim("No environment sessions in this process."));
  console.log(C.bold("Environment sessions"));
  for (const s of sessions) {
    console.log(`  ${s.sessionId}`);
    console.log(`    type:${s.type} state:${s.state} actions:${s.actionsPerformed} cleanup:${s.cleanupState}${s.quarantineReason ? ` quarantined:${s.quarantineReason}` : ""}`);
  }
}

async function cmdClose(store: Store, id: string | undefined, flags: string[]): Promise<void> {
  if (!id) {
    console.log(C.amber("usage: xr env close <sessionId>  (or: xr env close-all)"));
    return;
  }
  const res = await closeEnvironmentSession(store, id);
  if (flags.includes("--json")) return json(res);
  console.log(res.ok ? C.green(`session ${id} closed${res.note ? ` (${res.note})` : ""}`) : C.red(res.note ?? `could not close ${id}`));
}

async function cmdCloseAll(store: Store, flags: string[]): Promise<void> {
  const sessions = listEnvironmentSessions().filter((s) => s.state !== "closed" && s.state !== "quarantined");
  const results = [] as { sessionId: string; ok: boolean; note?: string }[];
  for (const s of sessions) {
    const res = await closeEnvironmentSession(store, s.sessionId, "close-all requested");
    results.push({ sessionId: s.sessionId, ok: res.ok, note: res.note });
  }
  if (flags.includes("--json")) return json({ closed: results });
  for (const r of results) console.log(`  ${r.ok ? C.green("✓") : C.red("✗")} ${r.sessionId}${r.note ? C.dim(` — ${r.note}`) : ""}`);
  if (!results.length) console.log(C.dim("No active sessions."));
}

async function cmdHistory(flags: string[]): Promise<void> {
  const limitFlag = flags.find((f) => f.startsWith("--limit="));
  const limit = limitFlag ? Number(limitFlag.split("=")[1]) || 50 : 50;
  const records = environmentHistory(limit);
  if (flags.includes("--json")) return json({ records });
  if (!records.length) return void console.log(C.dim("No environment actions recorded in this process yet."));
  console.log(C.bold("Environment action history"));
  for (const r of records) {
    const mark =
      r.outcome === "succeeded" ? C.green(r.outcome) : r.outcome === "denied" || r.outcome === "blocked" ? C.amber(r.outcome) : C.red(r.outcome);
    console.log(`  ${mark}  ${r.environment}/${r.interaction}  risk:${r.riskLevel}  rev:${r.reversibility}  appr:${r.approval.required}  ${r.message.slice(0, 90)}`);
  }
}

async function cmdObservations(flags: string[]): Promise<void> {
  const observations = environmentObservations.list().map((o) => ({
    observationId: o.observationId,
    source: o.source,
    provenance: o.provenance,
    confidence: o.confidence,
    sensitivity: o.sensitivity,
    sessionId: o.sessionId,
    capturedAt: o.capturedAt,
    staleAfterMs: o.staleAfterMs,
    summary: o.summary,
    artifact: o.artifact ? { path: o.artifact.path, bytes: o.artifact.bytes, sha256: o.artifact.sha256.slice(0, 16) + "…" } : undefined,
  }));
  if (flags.includes("--json")) return json({ observations });
  if (!observations.length) return void console.log(C.dim("No live observations (they expire quickly by design)."));
  console.log(C.bold("Live observations (references only — raw media is never listed)"));
  for (const o of observations) {
    console.log(`  ${o.observationId}  ${o.source}/${o.provenance}  conf:${o.confidence}  sens:${o.sensitivity}  ${o.summary.slice(0, 70)}`);
  }
}

async function cmdPolicy(flags: string[]): Promise<void> {
  const cfg = getEnvironmentConfig() ?? null;
  const kill = environmentDisabled();
  const out = { disabled: kill, config: cfg };
  if (flags.includes("--json")) return json(out);
  console.log(C.bold("Environment policy"));
  console.log(`  layer enabled .... ${kill.disabled ? C.red(`no (${kill.reason})`) : C.green("yes")}`);
  if (cfg) {
    console.log(`  modalities ....... ${Object.entries(cfg.modalities ?? {}).map(([k, v]) => `${k}:${v ? "on" : "off"}`).join(" ")}`);
    console.log(`  browser net ...... private-network block: ${cfg.browser?.blockPrivateNetworks ? "on" : "off"}; allowed:[${(cfg.browser?.allowedDomains ?? []).join(",")}] blocked:[${(cfg.browser?.blockedDomains ?? []).join(",")}]`);
    console.log(`  vision cloud ..... ${cfg.vision?.allowCloud ? C.amber("ALLOWED (explicit opt-in)") : "off (local only)"}`);
    console.log(`  recovery ......... retries:${cfg.recovery?.maxReobserveRetries} circuit:${cfg.recovery?.circuitFailures} failures/${Math.round((cfg.recovery?.circuitCooldownMs ?? 60000) / 1000)}s`);
  }
}

export async function handleEnvironmentCommand(argv: string[], store: Store): Promise<void> {
  const sub = argv[0] ?? "status";
  const flags = argv.slice(1);
  switch (sub) {
    case "status":
      return cmdStatus(flags);
    case "capabilities":
      return cmdCapabilities(flags);
    case "sessions":
      return cmdSessions(flags);
    case "close":
      return cmdClose(store, argv[1], flags.slice(1).filter((f) => f.startsWith("--")));
    case "close-all":
      return cmdCloseAll(store, flags);
    case "history":
      return cmdHistory(flags);
    case "observations":
      return cmdObservations(flags);
    case "policy":
      return cmdPolicy(flags);
    default:
      console.log(C.amber(`unknown env subcommand '${sub}'`));
      console.log("usage: xr env [status|capabilities|sessions|close <id>|close-all|history|observations|policy] [--json]");
  }
}
