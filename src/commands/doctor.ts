/** XR — Doctor Command */
import { Command, CommandContext } from "../core/command-registry.ts";
import { printStatus, probeHealth, detectPlatform } from "../install/system.ts";
import { ProviderService } from "../services/provider-service.ts";
import { Store } from "../state/db.ts";
import { MemoryStore } from "../memory/store.ts";
import { isMemoryEnabled } from "../config/config.ts";
import { banner, colors as C, ok, warn } from "../interfaces/cli.ts";

export class DoctorCommand implements Command {
  name = "doctor";
  description = "system health, dependency, audit, and provider check";
  usage = "xr doctor [--network] [--json]";

  async execute(ctx: CommandContext): Promise<void> {
    const json = ctx.args.includes("--json");
    let store: Store;
    try { store = ctx.container.resolve<Store>("legacyStore"); } catch { store = new Store(); }
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

    console.log(""); console.log(C.bold("Memory Engine"));
    const memState = !memEnabled ? C.red("✗ disabled") : memHealth.expired > 0 ? C.amber(`! ${memHealth.total} entries (${memHealth.expired} expired)`) : C.green(`✓ ${memHealth.total} entries`);
    console.log(`  enabled ........ ${memState}`);
    if (memEnabled && memHealth.ok) { if (memHealth.byCategory.length) { const cats = memHealth.byCategory.map((s) => `${s.category}: ${s.c}`).join(" · "); console.log(`  by category .... ${C.dim(cats)}`); } }
  }
}
