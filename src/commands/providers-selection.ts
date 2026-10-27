/** Existing provider command selection handler; --force is configured-only, never health proof. */
import type { ProviderService } from "../services/provider-service.ts";
import { usageError } from "../cli/errors.ts";
import { warn, ok, colors as C } from "../interfaces/cli.ts";
export async function setProvider(
  ps: ProviderService,
  args: string[],
): Promise<void> {
  const force = args.includes("--force") || args.includes("--force=true");
  const positional = args.filter((a) => !a.startsWith("--"));
  const [id, model] = positional;
  if (!id) {
    warn("Usage: xr providers set <id> [model] [--force]");
    console.log(`  ${C.dim("Examples:")}`);
    console.log(`    xr providers set ollama qwen2.5:7b`);
    console.log(`    xr providers set openai gpt-4o-mini`);
    console.log(
      `  ${C.dim("--force:")}  switch even when the canary probe cannot reach/auth the provider`,
    );
    console.log(`  ${C.dim("List:")} xr providers list`);
    return;
  }

  if (force) {
    if (!ps.getPreset(id)) throw usageError(`Unknown provider: ${id}`);
    await ps.setActiveProvider(id, model);
    ok(
      `Configured ${id}${model ? ` / ${model}` : ""} offline. No probes sent; authentication/reachability/agent validation remain unmeasured.`,
    );
    return;
  }

  // Phase 3 · T6 — model-switch state machine: preflight → warm → canary →
  // swap → verify, with rollback on failure. No unexplained waits: every
  // phase is timeout-bounded and reported.
  const { ModelSwitchStateMachine } =
    await import("../providers/model-switch.ts");
  const { Tokens } = await import("../core/tokens.ts");
  const configService = ps.getRegistry().resolve(Tokens.Config);
  const readActive = () => ({
    providerId: ps.getActiveProviderId(),
    model: configService.get().defaults?.model,
  });
  const machine = new ModelSwitchStateMachine({
    preflight: (t) => {
      const known = ps.getPreset(t.providerId) !== undefined;
      return known
        ? { ok: true, detail: `${t.providerId} is a known provider` }
        : { ok: false, detail: `unknown provider: ${t.providerId}` };
    },
    warm: async (t, timeoutMs) => {
      const report = await ps.checkHealth(t.providerId, t.model); // state machine owns the cleared deadline
      return report.ok
        ? {
            ok: true,
            detail: `${report.detail}${report.latencyMs ? ` (${report.latencyMs}ms)` : ""}`,
          }
        : { ok: false, detail: report.detail };
    },
    canary: async (t, timeoutMs) => {
      const report = await ps.checkHealth(t.providerId, t.model); // same bounded shared health service
      // A stored credential is not a successful canary. Offline selection
      // remains explicit via --force; failed probes retain the previous target.
      return report.ok
        ? {
            ok: true,
            detail: `${report.detail}${report.latencyMs ? ` (${report.latencyMs}ms)` : ""}`,
          }
        : { ok: false, detail: report.detail };
    },
    apply: async (t) => {
      await ps.setActiveProvider(t.providerId, t.model);
    },
    readActive,
  });

  const result = await machine.run({ providerId: id, model }, { force });
  for (const p of result.phases) {
    if (p.phase === "done" || p.phase === "rolled-back") continue;
    const icon = p.ok ? C.green("✓") : C.red("✗");
    console.log(
      `  ${icon} ${p.phase.padEnd(9)} ${p.detail} ${C.dim(`(${Math.round(p.ms)}ms)`)}`,
    );
  }
  if (result.ok) {
    ok(
      `Active model set to ${id}${model ? ` / ${model}` : ""} (persisted${result.forced ? " · forced" : ""}).`,
    );
    console.log(`  ${C.dim("Verify:")} xr providers list · xr models`);
    console.log(
      `  ${C.dim("Shell:")}   Alt+P or /model ${id}${model ? ` ${model}` : ""}`,
    );
    console.log(`  ${C.dim("Web:")}     xr serve → Providers → Change model`);
  } else {
    const failed = result.phases.find(
      (p) => !p.ok && p.phase !== "rolled-back",
    );
    warn(
      `Switch to ${id}${model ? ` / ${model}` : ""} NOT applied — kept ${result.previous.providerId}.`,
    );
    if (failed) console.log(`  ${C.dim(`Reason: ${failed.detail}`)}`);
    console.log(
      `  ${C.dim("To switch anyway (no canary): xr providers set <id> [model] --force")}`,
    );
    process.exitCode = 1;
  }
}
