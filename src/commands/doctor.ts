/** XR — Doctor Command */
import { CORE_VERSION, versionInfo } from "../core/version.ts";
import { Command, CommandContext } from "../core/command-registry.ts";
import { Tokens } from "../core/tokens.ts";
import { printStatus, probeHealth, detectPlatform, type HealthCheck } from "../install/system.ts";
import { configPath, loadConfig } from "../config/config.ts";
import { PRESETS } from "../providers/presets.ts";
import { WorkspaceStore } from "../state/workspace-store.ts";
import { MemoryStore } from "../context/memory/store.ts";
import { isMemoryEnabled } from "../config/config.ts";
import { banner, colors as C, ok, warn } from "../interfaces/cli.ts";
import { pluginDoctorLine } from "../plugins/cli.ts";
import {
  evaluateRunnable,
  runtimeEnvironment,
  safeConfigStatus,
  summarizeHealthChecks,
  workspaceStatus,
} from "../enterprise/baseline/status.ts";

// Bun-friendly dynamic import helper for perf benches (avoid require in types)
async function loadCatalog() {
  return import("../cli/catalog.ts");
}
async function loadFlags() {
  return import("../cli/flags.ts");
}

export class DoctorCommand implements Command {
  name = "doctor";
  description = "task-readiness check: reports whether XR can complete a task now";
  usage = "xr doctor [--deep] [--network] [--json] [--perf]";

  async execute(ctx: CommandContext): Promise<void> {
    const { isJsonMode } = await import("../cli/output.ts");
    const json = ctx.args.includes("--json") || isJsonMode();
    /**
     * Phase 0 · T4 — active path by default, full probes behind `--deep`.
     *
     * Readiness means "can XR complete a task now", which depends on the
     * providers and the workspace. Voice, control, environment and capability
     * probes are diagnostic breadth, not readiness, so they only run with
     * `--deep` (or `--network`, kept for backwards compatibility).
     */
    const deep = ctx.args.includes("--deep") || ctx.args.includes("--network");
    if (ctx.args.includes("--perf")) {
      await runPerfBenchmarks(json);
      return;
    }
    /** 0.2 Storage Unification: Always resolve from container, never create new Store(). */
    const store = ctx.registry.resolve(Tokens.Store);
    const mem = new MemoryStore(store);
    const memHealth = mem.health();
    const memEnabled = isMemoryEnabled();
    const researchRows = store.listResearch(5);
    const researchCount = store.researchCount();
    const latestResearch = researchRows[0];

    if (json) {
      const opts: any = {}; for (const a of ctx.args) if (a === "--network") opts.network = true;
      const checks = await probeHealth(opts);
      try {
        const providerService = ctx.registry.resolve(Tokens.Providers);
        const reports = await providerService.checkAllProviders();
        for (const r of reports) checks.push({ id: `provider-${r.id}`, label: `Provider: ${r.id}`, state: r.ok ? "ok" : r.authOk ? "warn" : "fail", detail: r.detail });
      } catch(e){ checks.push({ id:"providers", label:"Provider health", state:"warn", detail:(e as Error).message });}
      checks.push({ id:"research", label:"Research engine", state:"ok", detail:`${researchCount} sessions` });
      if (deep) { try { const { checkVoiceStack } = await import("../voice/index.ts"); for(const c of (await checkVoiceStack()).checks) checks.push({ id:c.id, label:c.label, state:c.state, detail:c.detail }); } catch(e){ checks.push({ id:"voice", label:"Voice stack", state:"warn", detail:(e as Error).message });} }
      checks.push({ id:"memory", label:"Memory engine", state: memEnabled ? "ok" : "warn", detail: `${memHealth.total} entries` });
      try { const { PluginManager } = await import("../plugins/manager.ts"); const pm = new PluginManager(store, ctx.cwd); await pm.loadEnabled(); const ps = pm.summary(); checks.push({ id:"plugins", label:"Plugin platform", state: ps.errored ? "warn" : "ok", detail: `${ps.installed} installed, ${ps.enabled} enabled, ${ps.errored} need attention` }); } catch(e){ checks.push({ id:"plugins", label:"Plugin platform", state:"warn", detail:(e as Error).message }); }
      try { const { McpManager } = await import("../mcp/manager.ts"); const mm = new McpManager(store, ctx.cwd); await mm.loadEnabled(); const ms = mm.summary(); checks.push({ id:"mcp", label:"MCP platform", state: ms.errored ? "warn" : "ok", detail: `${ms.installed} servers, ${ms.enabled} enabled, ${ms.healthy} healthy` }); } catch(e){ checks.push({ id:"mcp", label:"MCP platform", state:"warn", detail:(e as Error).message }); }
      if (deep) { try { const caps = ctx.registry.resolve(Tokens.Capabilities).health(); checks.push({ id:"capabilities", label:"Capability Ecosystem", state: caps.quarantined ? "warn" : "ok", detail: `${caps.total} capabilities, ${caps.certified} certified, ${caps.quarantined} quarantined` }); } catch(e){ checks.push({ id:"capabilities", label:"Capability Ecosystem", state:"warn", detail:(e as Error).message }); } }
      try { const wf = ctx.registry.resolve(Tokens.WorkflowStore); const { listAgents } = await import("../agents/registry.ts"); const health = wf.health(); checks.push({ id:"multi-agent", label:"Multi-agent runtime", state: health.workflows.failed ? "warn" : "ok", detail: `${listAgents({ includeDisabled: true }).length} agents, ${health.workflows.total} workflows, ${health.workflows.running} running` }); } catch(e){ checks.push({ id:"multi-agent", label:"Multi-agent runtime", state:"warn", detail:(e as Error).message }); }
      // control
      if (deep) { try { const { detectCapabilities } = await import("../control/adapter.ts"); const caps = detectCapabilities(); checks.push({ id:"control", label:"Computer Control", state: caps.tools.keyboard ? "ok":"warn", detail: `${caps.os} · keyboard:${caps.tools.keyboard} mouse:${caps.tools.mouse}` }); } catch(e){ checks.push({ id:"control", label:"Computer Control", state:"warn", detail:(e as Error).message }); } }
      // XR 5.1 — environment interaction OS capability summary
      if (deep) try {
        const { detectEnvironmentCapabilities, environmentDisabled } = await import("../platform/environment/service.ts");
        const kill = environmentDisabled();
        if (kill.disabled) {
          checks.push({ id:"environment", label:"Environment OS", state:"warn", detail:`disabled (${kill.reason})` });
        } else {
          const report = await detectEnvironmentCapabilities();
          const unsupported = report.entries.filter((e) => e.support === "unsupported").map((e) => e.environment);
          const partial = report.entries.filter((e) => e.support === "partial").map((e) => e.environment);
          const state = unsupported.length ? "warn" : partial.length ? "ok" : "ok";
          const parts = [] as string[];
          if (unsupported.length) parts.push(`unsupported: ${unsupported.join(",")}`);
          if (partial.length) parts.push(`partial: ${partial.join(",")}`);
          checks.push({ id:"environment", label:"Environment OS", state, detail: parts.join(" · ") || "all modalities supported" });
        }
      } catch(e){ checks.push({ id:"environment", label:"Environment OS", state:"warn", detail:(e as Error).message }); }
      const configResult = loadConfig();
      const workspaceContext = ctx.registry.resolve(Tokens.Workspaces).getActiveContext();
      const providerKeyEnvs = [...new Set(Object.values(PRESETS).map((p) => p.apiKeyEnv).filter((v): v is string => Boolean(v)))];
      const summary = summarizeHealthChecks(checks);
      if (summary.exitCode !== 0) process.exitCode = summary.exitCode;
      console.log(JSON.stringify({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        version: versionInfo(),
        environment: runtimeEnvironment(),
        platform: detectPlatform(),
        workspace: workspaceStatus({
          id: workspaceContext.id,
          rootDir: workspaceContext.rootDir,
          configPath: workspaceContext.configPath,
          dbPath: store.dbPath,
          connectionCount: WorkspaceStore.connectionCount(),
        }),
        config: safeConfigStatus({ path: configPath(), warnings: configResult.warnings, config: configResult.config, providerKeyEnvs }),
        summary,
        checks,
      }, null, 2)); return;
    }

    await printStatus(ctx.args);

    /**
     * Phase 0 · T4 — the readiness verdict.
     *
     * `printStatus` above answers "is XR installed correctly". The block below
     * answers the question the user actually asked — "can XR complete a task
     * now" — and is the value that drives the exit code.
     */
    const readinessChecks: HealthCheck[] = [];
    try {
      const providerService = ctx.registry.resolve(Tokens.Providers);
      const reports = await providerService.checkAllProviders();
      for (const r of reports) {
        readinessChecks.push({
          id: `provider-${r.id}`,
          label: `Provider: ${r.id}`,
          state: r.ok ? "ok" : r.authOk ? "warn" : "fail",
          detail: r.detail,
        });
      }
      if (reports.length) { console.log(""); console.log(C.bold("Provider Health")); for (const r of reports) { const status = r.ok ? C.green("✓") : r.authOk ? C.amber("!") : C.red("✗"); console.log(`  ${r.id.padEnd(12)} ${status}  ${r.detail}`); } }
    } catch(e){ warn(`Provider health check failed: ${(e as Error).message}`); }

    console.log(""); console.log(C.bold("Research Engine"));
    console.log(`  sessions ....... ${C.green(`✓ ${researchCount}`)}`);
    if (latestResearch) console.log(`  latest ......... ${C.dim(`${latestResearch.id} · ${latestResearch.status}`)}`);

    console.log(""); console.log(C.bold("Voice Stack"));
    try { const { checkVoiceStack } = await import("../voice/index.ts"); const voice = await checkVoiceStack(); for (const c of voice.checks) { const status = c.state === "ok" ? C.green("✓") : c.state === "warn" ? C.amber("!") : C.red("✗"); console.log(`  ${c.label.padEnd(20)} ${status} ${C.dim(c.detail)}`); } } catch(e){ warn(`Voice health check failed: ${(e as Error).message}`); }

    console.log(""); console.log(C.bold("Plugin Platform"));
    console.log(`  health ......... ${await pluginDoctorLine(store)}`);

    console.log(""); console.log(C.bold("Capability Ecosystem"));
    try {
      const caps = ctx.registry.resolve(Tokens.Capabilities).health();
      console.log(`  indexed ........ ${C.green(`✓ ${caps.total}`)}`);
      console.log(`  certified ...... ${C.green(String(caps.certified))}`);
      console.log(`  quarantined .... ${caps.quarantined ? C.amber(String(caps.quarantined)) : C.green("0")}`);
    } catch(e){ warn(`Capability health failed: ${(e as Error).message}`); }

    // Stage 9 — Control Health
    console.log(""); console.log(C.bold("Computer Control"));
    try {
      const { detectCapabilities, isControlReady } = await import("../control/adapter.ts");
      const { listPermissions } = await import("../control/permissions.ts");
      const caps = detectCapabilities();
      console.log(`  enabled ........ ${isControlReady(caps) ? C.green("✓ ready") : C.amber("! partial")}`);
      console.log(`  os ............. ${caps.os}`);
      console.log(`  keyboard ....... ${caps.tools.keyboard ? C.green("✓") : C.red("✗")}`);
      console.log(`  mouse .......... ${caps.tools.mouse ? C.green("✓") : C.red("✗")}`);
      console.log(`  permissions .... ${C.dim(listPermissions().join(", ") || "(none)")}`);
      if (caps.missing.length) console.log(`  missing ........ ${C.amber(caps.missing.join("; "))}`);
    } catch(e){ warn(`Control health failed: ${(e as Error).message}`); }

    console.log(""); console.log(C.bold("Multi-Agent Runtime"));
    try {
      const wf = ctx.registry.resolve(Tokens.WorkflowStore);
      const { listAgents } = await import("../agents/registry.ts");
      const health = wf.health();
      console.log(`  agents ......... ${C.green(`✓ ${listAgents({ includeDisabled: true }).length} registered`)}`);
      console.log(`  workflows ...... ${C.dim(`${health.workflows.total} total · ${health.workflows.running} running · ${health.workflows.blocked} blocked · ${health.workflows.failed} failed`)}`);
    } catch(e){ warn(`Multi-agent health failed: ${(e as Error).message}`); }

    console.log(""); console.log(C.bold("Memory Engine"));
    const memState = !memEnabled ? C.red("✗ disabled") : memHealth.expired > 0 ? C.amber(`! ${memHealth.total} entries (${memHealth.expired} expired)`) : C.green(`✓ ${memHealth.total} entries`);
    console.log(`  enabled ........ ${memState}`);
    if (memEnabled && memHealth.ok) { if (memHealth.byCategory.length) { const cats = memHealth.byCategory.map((s) => `${s.category}: ${s.c}`).join(" · "); console.log(`  by category .... ${C.dim(cats)}`); } }

    // ── Readiness verdict (drives the exit code) ─────────────────────────────
    const verdict = evaluateRunnable(readinessChecks, []);
    console.log("");
    console.log(C.bold("Readiness"));
    if (verdict.runnable) {
      console.log(`  ${C.green("✓ XR can complete a task now")} ${C.dim(`· ${verdict.runnableReason}`)}`);
    } else {
      console.log(`  ${C.red("✗ XR cannot complete a task")} ${C.dim(`· ${verdict.runnableReason}`)}`);
      console.log(`  ${C.dim("→")} Next: run ${C.bold("xr config")} to set a provider key, or start a local model runtime.`);
      process.exitCode = 1;
    }
    if (!deep) console.log(C.dim("  (run `xr doctor --deep` for voice, control, capability and environment probes)"));
  }
}

/**
 * Lightweight startup microbenchmarks (Performance Standards §8 / §10).
 * Measures help/version fast-path style work without booting providers.
 */
async function runPerfBenchmarks(asJson: boolean): Promise<void> {
  const samples = 5;
  const measure = (fn: () => void): number[] => {
    const times: number[] = [];
    for (let i = 0; i < samples; i++) {
      const t0 = performance.now();
      fn();
      times.push(performance.now() - t0);
    }
    return times;
  };
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
  };

  const { CATALOG } = await loadCatalog();
  const { parseGlobalFlags } = await loadFlags();

  const versionMs = measure(() => {
    void `v${CORE_VERSION}`;
  });

  const helpMs = measure(() => {
    void CATALOG.length;
    void CATALOG.map((c) => c.name + c.description).join("\n");
  });

  const flagsMs = measure(() => {
    parseGlobalFlags(["providers", "list", "--json", "--workspace", "default"]);
  });

  const results = [
    { id: "version-string", targetMs: 100, medianMs: median(versionMs), samples: versionMs },
    { id: "catalog-help-build", targetMs: 200, medianMs: median(helpMs), samples: helpMs },
    { id: "flag-parse", targetMs: 50, medianMs: median(flagsMs), samples: flagsMs },
  ].map((r) => ({ ...r, pass: r.medianMs <= r.targetMs }));

  if (asJson) {
    console.log(JSON.stringify({ ok: results.every((r) => r.pass), results }, null, 2));
    return;
  }

  banner();
  console.log(C.bold("CLI performance microbenchmarks"));
  console.log(C.dim(`  ${samples}-run median · targets from XR performance standards\n`));
  for (const r of results) {
    const mark = r.pass ? C.green("PASS") : C.red("FAIL");
    console.log(
      `  ${mark}  ${r.id.padEnd(22)}  ${r.medianMs.toFixed(2)}ms  ${C.dim(`(target ≤ ${r.targetMs}ms)`)}`,
    );
  }
  console.log();
  console.log(C.dim("Note: full `xr --version` / `xr help` wall times depend on Bun cold start."));
  console.log(C.dim("These benches measure in-process work after the runtime is up."));
  console.log();
}
