#!/usr/bin/env bun
/**
 * XR-LAUNCH-012 — keyless leg of Provider Canaries: proves the canary harness
 * itself (preset construction, health probe, report, exit codes) against the
 * deterministic loopback fixture provider. No secrets, no paid calls; runs on
 * every schedule so a broken harness is not mistaken for "no keys configured".
 *
 *   bun run scripts/canary-fixture.ts [--json <report.json>]
 */
import { startFixtureProvider } from "./journey/fixtures.ts";

const provider = await startFixtureProvider();
process.env.XR_CANARY_BASEURL_LMSTUDIO = provider.url;
process.env.XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER = "1";
const { main } = await import("./provider-canaries.ts");
const jsonIdx = process.argv.indexOf("--json");
const code = await main(["--only", "lmstudio", ...(jsonIdx > 0 ? ["--json", process.argv[jsonIdx + 1]!] : [])]);
const probed = provider.requests.length;
await provider.close();
if (code === 0 && probed === 0) {
  console.error("[canary-fixture] the canary passed without contacting the fixture — the harness is not probing");
  process.exit(1);
}
console.log(`[canary-fixture] exit ${code}; fixture saw ${probed} request(s)`);
process.exit(code);
