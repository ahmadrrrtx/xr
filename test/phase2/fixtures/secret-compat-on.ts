/**
 * Test fixture — verifies the HYDRATION-ON secret posture in a CHILD process.
 *
 * Phase 8 · F-24 note: hydration is no longer the default. This fixture is
 * driven with an explicit `XR_SECRETS_ENV_HYDRATION=1` by its parent, so it
 * now tests the OPT-IN path (an operator who deliberately wants XR to export
 * keys to child processes) rather than the out-of-the-box behaviour. The
 * default posture is covered by secret-compat-off.ts and by the Phase 8
 * env-census test.
 *
 * Usage: bun run test/phase2/fixtures/secret-compat-on.ts
 * Emits a single JSON line:
 *   { flagEnabled, envAfterSet, synced, envAfterHydrate, asynced }
 */
import { writeSync } from "node:fs";
import { envHydrationEnabled } from "../../../src/security/env-compat.ts";
import { secretBroker, secretBrokerSync, hydrateProviderEnv } from "../../../src/security/secret-broker.ts";
import { setSecret } from "../../../src/security/secrets.ts";

const envOf = (k: string): string | undefined => (process.env as Record<string, string | undefined>)[k];

async function main(): Promise<void> {
  const result: Record<string, unknown> = { flagEnabled: envHydrationEnabled() };

  delete process.env.XR_BROKER_TEST_ON;
  setSecret("XR_BROKER_TEST_ON", "v1-secret");
  result.envAfterSet = envOf("XR_BROKER_TEST_ON");
  result.synced = secretBrokerSync("XR_BROKER_TEST_ON");

  delete process.env.XR_BROKER_TEST_ON2;
  hydrateProviderEnv("XR_BROKER_TEST_ON2", "v2-secret");
  result.envAfterHydrate = envOf("XR_BROKER_TEST_ON2");

  delete process.env.XR_BROKER_TEST_ON3;
  setSecret("XR_BROKER_TEST_ON3", "v5-secret");
  result.asynced = await secretBroker.get("XR_BROKER_TEST_ON3");

  writeSync(1, JSON.stringify(result) + "\n");
}

// Exit deterministically: the secret backends spawn async OS processes
// (keychain/secret-service) whose handles can keep the bun event loop alive
// on Windows, which would hang the parent's `await proc.exited` forever.
void main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    writeSync(2, String(err) + "\n");
    process.exit(1);
  });
