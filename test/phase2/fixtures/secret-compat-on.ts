/**
 * Test fixture — verifies the DEFAULT (1.0) secret posture in a CHILD
 * process whose own module-load snapshot sees no compat flag. The parent
 * passes a private XR_HOME through the spawn env, so no global process.env
 * mutation ever leaks into sibling test files.
 *
 * Usage: bun run test/phase2/fixtures/secret-compat-on.ts
 * Emits a single JSON line:
 *   { flagEnabled, envAfterSet, synced, envAfterHydrate, asynced }
 */
import { writeSync } from "node:fs";
import { envSecretCompatEnabled } from "../../../src/security/env-compat.ts";
import { secretBroker, secretBrokerSync, hydrateProviderEnv } from "../../../src/security/secret-broker.ts";
import { setSecret } from "../../../src/security/secrets.ts";

const envOf = (k: string): string | undefined => (process.env as Record<string, string | undefined>)[k];

async function main(): Promise<void> {
  const result: Record<string, unknown> = { flagEnabled: envSecretCompatEnabled() };

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

void main();
