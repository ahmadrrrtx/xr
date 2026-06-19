/**
 * XR — Doctor Command
 * Stage 3: includes provider health matrix in diagnostics.
 */
import { Command, CommandContext } from "../core/command-registry.ts";
import {
  printStatus,
  probeHealth,
  detectPlatform,
} from "../install/system.ts";
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

    // Stage 6 — memory health (shared engine over the legacy store).
    let store: Store;
    try {
      store = ctx.container.resolve<Store>("legacyStore");
    } catch {
      store = new Store();
    }
    const mem = new MemoryStore(store);
    const memHealth = mem.health();
    const memEnabled = isMemoryEnabled();
    const researchRows = store.listResearch(5);
    const researchCount = store.researchCount();
    const latestResearch = researchRows[0];

    if (json) {
      // Build combined JSON output including provider health
      const opts: any = {};
      for (const a of ctx.args) if (a === "--network") opts.network = true;
      const checks = await probeHealth(opts);

      try {
        const providerService = ctx.container.resolve<ProviderService>(
          "providers",
        );
        const reports = await providerService.checkAllProviders();
        for (const r of reports) {
          checks.push({
            id: `provider-${r.id}`,
            label: `Provider: ${r.id}`,
            state: r.ok ? "ok" : r.authOk ? "warn" : "fail",
            detail: r.detail,
            remediation: r.ok
              ? undefined
              : r.authOk
              ? "Provider endpoint unreachable"
              : `Set API key or run: xr providers add ${r.id}`,
          });
        }
      } catch (e) {
        checks.push({
          id: "providers",
          label: "Provider health",
          state: "warn",
          detail: (e as Error).message,
        });
      }

      // Stage 7 — research health check.
      checks.push({
        id: "research",
        label: "Research engine",
        state: researchCount >= 0 ? "ok" : "warn",
        detail: `${researchCount} sessions${latestResearch ? `; latest ${latestResearch.status} (${latestResearch.depth})` : ""}`,
        remediation: latestResearch?.status === "stopped" || latestResearch?.status === "error" ? "Inspect with: xr research status" : undefined,
      });

      // Stage 8 — voice health check.
      try {
        const { checkVoiceStack } = await import("../voice/index.ts");
        for (const c of checkVoiceStack().checks) {
          checks.push({
            id: c.id,
            label: c.label,
            state: c.state,
            detail: c.detail,
            remediation: c.remediation,
          });
        }
      } catch (e) {
        checks.push({ id: "voice", label: "Voice stack", state: "warn", detail: (e as Error).message });
      }

      // Stage 6 — memory health check.
      checks.push({
        id: "memory",
        label: "Memory engine",
        state: memEnabled && memHealth.ok && memHealth.expired === 0
          ? "ok"
          : memHealth.expired > 0 ? "warn" : memEnabled ? "ok" : "warn",
        detail: memEnabled
          ? `${memHealth.total} entries (${memHealth.expired} expired, ${memHealth.neverAccessed} never recalled)`
          : "disabled",
        remediation: !memEnabled
          ? 'Enable: set "memory.enabled": true (or unset XR_MEMORY_DISABLED)'
          : memHealth.expired > 0
          ? "Run: xr memory prune"
          : undefined,
      });

      console.log(
        JSON.stringify(
          { platform: detectPlatform(), checks },
          null,
          2,
        ),
      );
      return;
    }

    // Text mode: print base status, then append provider health
    await printStatus(ctx.args);

    try {
      const providerService = ctx.container.resolve<ProviderService>(
        "providers",
      );
      const reports = await providerService.checkAllProviders();
      if (reports.length) {
        console.log("");
        console.log(C.bold("Provider Health"));
        for (const r of reports) {
          const status = r.ok
            ? C.green("✓")
            : r.authOk
            ? C.amber("!")
            : C.red("✗");
          const latency = r.latencyMs ? C.dim(` ${r.latencyMs}ms`) : "";
          console.log(
            `  ${r.id.padEnd(12)} ${status}  ${r.detail}${latency}`,
          );
        }
      }
    } catch (e) {
      warn(`Provider health check failed: ${(e as Error).message}`);
    }

    // Stage 7 — research health.
    console.log("");
    console.log(C.bold("Research Engine"));
    console.log(`  sessions ....... ${C.green(`✓ ${researchCount}`)}`);
    if (latestResearch) {
      console.log(`  latest ......... ${C.dim(`${latestResearch.id} · ${latestResearch.status} · ${latestResearch.topic}`)}`);
      console.log(`  inspect ........ ${C.dim("xr research status  ·  xr research sources  ·  xr research refresh")}`);
    } else {
      console.log(`  start .......... ${C.dim('xr research "your topic"')}`);
    }

    // Stage 8 — voice health.
    console.log("");
    console.log(C.bold("Voice Stack"));
    try {
      const { checkVoiceStack } = await import("../voice/index.ts");
      const voice = checkVoiceStack();
      for (const c of voice.checks) {
        const status = c.state === "ok" ? C.green("✓") : c.state === "warn" ? C.amber("!") : C.red("✗");
        console.log(`  ${c.label.padEnd(20)} ${status} ${C.dim(c.detail)}`);
      }
    } catch (e) {
      warn(`Voice health check failed: ${(e as Error).message}`);
    }

    // Stage 6 — memory health.
    console.log("");
    console.log(C.bold("Memory Engine"));
    const memState = !memEnabled ? C.red("✗ disabled")
      : memHealth.expired > 0 ? C.amber(`! ${memHealth.total} entries (${memHealth.expired} expired)`)
      : C.green(`✓ ${memHealth.total} entries`);
    console.log(`  enabled ........ ${memState}`);
    if (memEnabled && memHealth.ok) {
      if (memHealth.byCategory.length) {
        const cats = memHealth.byCategory.map((s) => `${s.category}: ${s.c}`).join(" · ");
        console.log(`  by category .... ${C.dim(cats)}`);
      }
      if (memHealth.expired > 0) {
        warn(`${memHealth.expired} expired entr${memHealth.expired === 1 ? "y" : "ies"} — run: xr memory prune`);
      }
      console.log(`  inspect ........ ${C.dim("xr memory list  ·  xr memory health")}`);
    } else if (!memEnabled) {
      warn('memory off — re-enable with "memory.enabled": true');
    }
  }
}
