/** XR — Doctor Command */
import { CORE_VERSION } from "../core/version.ts";
import { Command, CommandContext } from "../core/command-registry.ts";
import { printStatus, probeHealth, detectPlatform } from "../install/system.ts";
import { ProviderService } from "../services/provider-service.ts";
import { Store } from "../state/workspace-store.ts";
import { MemoryStore } from "../memory/store.ts";
import { isMemoryEnabled } from "../config/config.ts";
import { banner, colors as C, ok, warn } from "../interfaces/cli.ts";
import { pluginDoctorLine } from "../plugins/cli.ts";

// Bun-friendly dynamic import helper for perf benches (avoid require in types)
async function loadCatalog() {
  return import("../cli/catalog.ts");
}
async function loadFlags() {
  return import("../cli/flags.ts");
}

export class DoctorCommand implements Command {
  name = "doctor";
  description = "system health, dependency, audit, and provider check";
  usage = "xr doctor [--network] [--json] [--perf]";

  async execute(ctx: CommandContext): Promise<void> {
    const { isJsonMode } = await import("../cli/output.ts");
    const json = ctx.args.includes("--json") || isJsonMode();
    if (ctx.args.includes("--perf")) {
      await runPerfBenchmarks(json);
      return;
    }
    /** 0.2 Storage Unification: Always resolve from container, never create new Store(). */
    const store = ctx.container.resolve<Store>("store");
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
        const providerService = ctx.container.resolve<ProviderService>("providers");
        const reports = await providerService.checkAllProviders();
        for (const r of reports) checks.push({ id: `provider-${r.id}`, label: `Provider: ${r.id}`, state: r.ok ? "ok" : r.authOk ? "warn" : "fail", detail: r.detail });
      } catch(e){ checks.push({ id:"providers", label:"Provider health", state:"warn", detail:(e as Error).message });}
      checks.push({ id:"research", label:"Research engine", state:"ok", detail:`${researchCount} sessions` });
      try { const { checkVoiceStack } = await import("../voice/index.ts"); for(const c of checkVoiceStack().checks) checks.push({ id:c.id, label:c.label, state:c.state, detail:c.detail }); } catch(e){ checks.push({ id:"voice", label:"Voice stack", state:"warn", detail:(e as Error).message });}
      checks.push({ id:"memory", label:"Memory engine", state: memEnabled ? "ok" : "warn", detail: `${memHealth.total} entries` });
      try { const { PluginManager } = await import("../plugins/manager.ts"); const pm = new PluginManager(store, ctx.cwd); await pm.loadEnabled(); const ps = pm.summary(); checks.push({ id:"plugins", label:"Plugin platform", state: ps.errored ? "warn" : "ok", detail: `${ps.installed} installed, ${ps.enabled} enabled, ${ps.errored} need attention` }); } catch(e){ checks.push({ id:"plugins", label:"Plugin platform", state:"warn", detail:(e as Error).message }); }
      try { const { McpManager } = await import("../mcp/manager.ts"); const mm = new McpManager(store, ctx.cwd); await mm.loadEnabled(); const ms = mm.summary(); checks.push({ id:"mcp", label:"MCP platform", state: ms.errored ? "warn" : "ok", detail: `${ms.installed} servers, ${ms.enabled} enabled, ${ms.healthy} healthy` }); } catch(e){ checks.push({ id:"mcp", label:"MCP platform", state:"warn", detail:(e as Error).message }); }
      try { const wf = ctx.container.resolve<any>("workflowStore"); const { listAgents } = await import("../agents/registry.ts"); const health = wf.health(); checks.push({ id:"multi-agent", label:"Multi-agent runtime", state: health.workflows.failed ? "warn" : "ok", detail: `${listAgents({ includeDisabled: true }).length} agents, ${health.workflows.total} workflows, ${health.workflows.running} running` }); } catch(e){ checks.push({ id:"multi-agent", label:"Multi-agent runtime", state:"warn", detail:(e as Error).message }); }
      // control
      try { const { detectCapabilities } = await import("../control/adapter.ts"); const caps = detectCapabilities(); checks.push({ id:"control", label:"Computer Control", state: caps.tools.keyboard ? "ok":"warn", detail: `${caps.os} · keyboard:${caps.tools.keyboard} mouse:${caps.tools.mouse}` }); } catch {}
      console.log(JSON.stringify({ platform: detectPlatform(), checks }, null, 2)); return;
    }

    await printStatus(ctx.args);

    try {
      const providerService = ctx.container.resolve<ProviderService>("providers");
      const reports = await providerService.checkAllProviders();
      if (reports.length) { console.log(""); console.log(C.bold("Provider Health")); for (const r of reports) { const status = r.ok ? C.green("✓") : r.authOk ? C.amber("!") : C.red("✗"); console.log(`  ${r.id.padEnd(12)} ${status}  ${r.detail}`); } }
    } catch(e){ warn(`Provider health check failed: ${(e as Error).message}`); }

    console.log(""); console.log(C.bold("Research Engine"));
    console.log(`  sessions ....... ${C.green(`✓ ${researchCount}`)}`);
    if (latestResearch) console.log(`  latest ......... ${C.dim(`${latestResearch.id} · ${latestResearch.status}`)}`);

    console.log(""); console.log(C.bold("Voice Stack"));
    try { const { checkVoiceStack } = await import("../voice/index.ts"); const voice = checkVoiceStack(); for (const c of voice.checks) { const status = c.state === "ok" ? C.green("✓") : c.state === "warn" ? C.amber("!") : C.red("✗"); console.log(`  ${c.label.padEnd(20)} ${status} ${C.dim(c.detail)}`); } } catch(e){ warn(`Voice health check failed: ${(e as Error).message}`); }

    console.log(""); console.log(C.bold("Plugin Platform"));
    console.log(`  health ......... ${await pluginDoctorLine(store)}`);

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
      const wf = ctx.container.resolve<any>("workflowStore");
      const { listAgents } = await import("../agents/registry.ts");
      const health = wf.health();
      console.log(`  agents ......... ${C.green(`✓ ${listAgents({ includeDisabled: true }).length} registered`)}`);
      console.log(`  workflows ...... ${C.dim(`${health.workflows.total} total · ${health.workflows.running} running · ${health.workflows.blocked} blocked · ${health.workflows.failed} failed`)}`);
    } catch(e){ warn(`Multi-agent health failed: ${(e as Error).message}`); }

    console.log(""); console.log(C.bold("Memory Engine"));
    const memState = !memEnabled ? C.red("✗ disabled") : memHealth.expired > 0 ? C.amber(`! ${memHealth.total} entries (${memHealth.expired} expired)`) : C.green(`✓ ${memHealth.total} entries`);
    console.log(`  enabled ........ ${memState}`);
    if (memEnabled && memHealth.ok) { if (memHealth.byCategory.length) { const cats = memHealth.byCategory.map((s) => `${s.category}: ${s.c}`).join(" · "); console.log(`  by category .... ${C.dim(cats)}`); } }
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
  console.log(C.dim(`  ${samples}-run median · targets from XR 3.1.5 (Helios) performance standards\n`));
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
