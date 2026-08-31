/**
 * XR Phase 2 · F-24 — SECRET BROKER SEAM tests.
 *
 *   [Unit] flag semantics: XR_SECRETS_ENV_COMPAT defaults ON for 1.0; only
 *          explicit off-values disable ambient hydration
 *   [Unit] compat ON  — setSecret hydrates process.env (1.0 behavior)
 *   [Unit] compat OFF — setSecret persists durably but NEVER lands in env;
 *          resolution still succeeds through the broker
 *   [Unit] hydrateProviderEnv is the one write gate
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  envSecretCompatEnabled,
  hydrateProviderEnv,
  secretBroker,
  secretBrokerSync,
} from "../../src/security/secret-broker.ts";
import { setSecret } from "../../src/security/secrets.ts";

let tmp: string;
const savedFlag = process.env.XR_SECRETS_ENV_COMPAT;
const savedHome = process.env.XR_HOME;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-p2-sec-"));
  process.env.XR_HOME = join(tmp, "home");
  delete process.env.XR_SECRETS_ENV_COMPAT;
});

afterEach(() => {
  if (savedFlag === undefined) delete process.env.XR_SECRETS_ENV_COMPAT;
  else process.env.XR_SECRETS_ENV_COMPAT = savedFlag;
  if (savedHome === undefined) delete process.env.XR_HOME;
  else process.env.XR_HOME = savedHome;
});

describe("flag semantics", () => {
  test("defaults ON for 1.0 (unset / empty)", () => {
    expect(envSecretCompatEnabled()).toBe(true);
    process.env.XR_SECRETS_ENV_COMPAT = "";
    expect(envSecretCompatEnabled()).toBe(true);
  });

  test("explicit off-values disable ambient hydration", () => {
    for (const off of ["0", "false", "off", "False", " OFF "]) {
      process.env.XR_SECRETS_ENV_COMPAT = off;
      expect(envSecretCompatEnabled()).toBe(false);
    }
  });

  test("on-values and typos keep 1.0 behavior (fail-safe toward working providers)", () => {
    for (const on of ["1", "true", "on", "TRUE", "yolo"]) {
      process.env.XR_SECRETS_ENV_COMPAT = on;
      expect(envSecretCompatEnabled()).toBe(true);
    }
  });
});

describe("compat ON (1.0 behavior)", () => {
  const envOf = (k: string): string | undefined => (process.env as Record<string, string | undefined>)[k];

  test("setSecret hydrates process.env and the broker resolves it", () => {
    delete process.env.XR_BROKER_TEST_ON;
    setSecret("XR_BROKER_TEST_ON", "v1-secret");
    expect(envOf("XR_BROKER_TEST_ON")).toBe("v1-secret");
    expect(secretBrokerSync("XR_BROKER_TEST_ON")).toBe("v1-secret");
  });

  test("hydrateProviderEnv writes env when compat is on", () => {
    delete process.env.XR_BROKER_TEST_ON2;
    hydrateProviderEnv("XR_BROKER_TEST_ON2", "v2-secret");
    expect(envOf("XR_BROKER_TEST_ON2")).toBe("v2-secret");
  });
});

describe("compat OFF (2.0 seam behavior)", () => {
  const envOf = (k: string): string | undefined => (process.env as Record<string, string | undefined>)[k];

  test("setSecret persists durably but NEVER lands in env; broker still resolves", async () => {
    process.env.XR_SECRETS_ENV_COMPAT = "0";
    delete process.env.XR_BROKER_TEST_OFF;

    setSecret("XR_BROKER_TEST_OFF", "v3-secret");
    expect(envOf("XR_BROKER_TEST_OFF")).toBeUndefined();

    // Sync + async broker paths resolve through the durable backend.
    expect(secretBrokerSync("XR_BROKER_TEST_OFF")).toBe("v3-secret");
    expect(await secretBroker.get("XR_BROKER_TEST_OFF")).toBe("v3-secret");
    expect(envOf("XR_BROKER_TEST_OFF")).toBeUndefined();
  });

  test("hydrateProviderEnv is a no-op when compat is off", () => {
    process.env.XR_SECRETS_ENV_COMPAT = "0";
    delete process.env.XR_BROKER_TEST_OFF2;
    hydrateProviderEnv("XR_BROKER_TEST_OFF2", "v4-secret");
    expect(envOf("XR_BROKER_TEST_OFF2")).toBeUndefined();
  });

  test("an ambient env value is ignored with compat off — the durable answer wins", () => {
    process.env.XR_SECRETS_ENV_COMPAT = "0";
    delete process.env.XR_BROKER_TEST_OFF3;
    setSecret("XR_BROKER_TEST_OFF3", "durable");
    process.env.XR_BROKER_TEST_OFF3 = "ambient-should-not-win";
    // With compat OFF the broker does not consult process.env at all.
    expect(secretBrokerSync("XR_BROKER_TEST_OFF3")).toBe("durable");
  });
});
