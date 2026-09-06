/**
 * Test fixture — verifies the XR_SECRETS_ENV_COMPAT=0 (2.0) posture in a
 * CHILD process whose own module-load snapshot sees the flag off. The parent
 * passes the flag + a private XR_HOME through the spawn env, so no global
 * process.env mutation ever leaks into sibling test files.
 *
 * Usage: bun run test/phase2/fixtures/secret-compat-off.ts
 * Emits a single JSON line:
 *   { envAfterSet, synced, asynced, envAfterHydrate }
 */
import { writeSync } from "node:fs";
import { envHydrationEnabled } from "../../../src/security/env-compat.ts";
import { secretBroker, secretBrokerSync, hydrateProviderEnv } from "../../../src/security/secret-broker.ts";
import { setSecret } from "../../../src/security/secrets.ts";

const envOf = (k: string): string | undefined => (process.env as Record<string, string | undefined>)[k];

async function main(): Promise<void> {
  const result: Record<string, unknown> = { flagEnabled: envHydrationEnabled() };

  setSecret("XR_BROKER_TEST_OFF", "v3-secret");
  result.envAfterSet = envOf("XR_BROKER_TEST_OFF");

  // Sync + async broker paths resolve through the durable backend.
  result.synced = secretBrokerSync("XR_BROKER_TEST_OFF");
  result.asynced = await secretBroker.get("XR_BROKER_TEST_OFF");
  result.envAfterResolve = envOf("XR_BROKER_TEST_OFF");

  // hydrateProviderEnv is a no-op when compat is off.
  hydrateProviderEnv("XR_BROKER_TEST_OFF2", "v4-secret");
  result.envAfterHydrate = envOf("XR_BROKER_TEST_OFF2");

  // An ambient env value is ignored with compat off — the durable answer wins.
  delete process.env.XR_BROKER_TEST_OFF3;
  setSecret("XR_BROKER_TEST_OFF3", "durable");
  process.env.XR_BROKER_TEST_OFF3 = "ambient-should-not-win";
  result.ambientWins = secretBrokerSync("XR_BROKER_TEST_OFF3");

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
