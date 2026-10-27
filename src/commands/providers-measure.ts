/** Existing explicitly opted-in bounded provider compatibility measurement; not live validation by inspection. */
import { Tokens } from "../core/tokens.ts";
import { banner, info, ok, warn, colors as C } from "../interfaces/cli.ts";
export async function measureProviders(
  registry: import("../core/service-registry.ts").ServiceRegistry,
  args: string[],
): Promise<void> {
  let intel: import("../intelligence/service.ts").IntelligenceService | null =
    null;
  try {
    intel = registry.resolve(Tokens.Intelligence);
  } catch {
    warn("Intelligence service not registered.");
    return;
  }
  const jsonMode = args.includes("--json");
  const idx = args.findIndex((a) => a === "--provider" || a === "-p");
  const midx = args.findIndex((a) => a === "--model" || a === "-m");
  const providerId = idx >= 0 ? args[idx + 1] : undefined;
  const modelId = midx >= 0 ? args[midx + 1] : undefined;

  if (!jsonMode) {
    banner();
    console.log(
      C.bold(
        "Behavioral measurement (explicit live probes; estimated USD admission ≤ $0.25)",
      ),
    );
    info(
      "Running bounded probes (structured-output, tool-use, refusal, context-retention). " +
        "Cloud targets are probed only when the workspace locality policy permits; bounded paid traffic may result.",
    );
  }
  const { measured, skipped } = await intel.measureModels({
    live: args.includes("--live"),
    ...(providerId !== undefined ? { providerId } : {}),
    ...(modelId !== undefined ? { modelId } : {}),
  });

  if (jsonMode) {
    console.log(JSON.stringify({ measured, skipped }, null, 2));
    return;
  }
  if (!measured.length && !skipped.length) {
    info("No models matched the filter.");
    return;
  }
  for (const c of measured) {
    ok(
      `${c.providerId}/${c.modelId} — overall ${c.overallFidelity.toFixed(2)} ` +
        `(tools ${c.toolUseFidelity}, structured ${c.structuredOutputFidelity}, retention ${c.contextRetention}, false-refusal ${c.refusalRate}; n=${c.samples})`,
    );
  }
  for (const s of skipped.slice(0, 12)) {
    console.log(`  ${C.dim("skip")} ${s.key} — ${s.reason}`);
  }
  console.log(
    C.dim("\nMeasured contracts: XR_HOME/cache/intelligence/behavioral.json"),
  );
}
