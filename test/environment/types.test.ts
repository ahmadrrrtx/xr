/** XR 5.1 — Environment contract unit tests (§10 unit). */
import { describe, test, expect } from "bun:test";
import {
  ENVIRONMENT_TYPES,
  ENVIRONMENT_STATES,
  VALID_ENVIRONMENT_TRANSITIONS,
  TERMINAL_ENVIRONMENT_STATES,
  isValidEnvironmentTransition,
  isObservationStale,
  confidenceAtLeast,
  TargetIdentitySchema,
  EnvironmentActionRequestSchema,
  defaultEnvironmentPolicy,
  type EnvironmentObservation,
} from "../../src/platform/environment/types.ts";

describe("environment types contract", () => {
  test("six environment types, no more", () => {
    expect(ENVIRONMENT_TYPES).toEqual(["browser", "desktop", "filesystem", "application", "voice", "vision"]);
  });

  test("lifecycle states match the §7.2 design list", () => {
    expect(ENVIRONMENT_STATES).toEqual([
      "discover",
      "provision",
      "ready",
      "active",
      "paused",
      "failed",
      "closing",
      "closed",
      "quarantined",
    ]);
  });

  test("every state has an explicit transition entry", () => {
    for (const s of ENVIRONMENT_STATES) {
      expect(VALID_ENVIRONMENT_TRANSITIONS[s]).toBeDefined();
    }
  });

  test("canonical lifecycle path is valid", () => {
    expect(isValidEnvironmentTransition("discover", "provision")).toBe(true);
    expect(isValidEnvironmentTransition("provision", "ready")).toBe(true);
    expect(isValidEnvironmentTransition("ready", "active")).toBe(true);
    expect(isValidEnvironmentTransition("active", "paused")).toBe(true);
    expect(isValidEnvironmentTransition("paused", "active")).toBe(true);
    expect(isValidEnvironmentTransition("active", "closing")).toBe(true);
    expect(isValidEnvironmentTransition("closing", "closed")).toBe(true);
  });

  test("invalid transitions are rejected", () => {
    expect(isValidEnvironmentTransition("discover", "active")).toBe(false);
    expect(isValidEnvironmentTransition("provision", "active")).toBe(false);
    expect(isValidEnvironmentTransition("ready", "closed")).toBe(false);
    expect(isValidEnvironmentTransition("closed", "active")).toBe(false);
    expect(isValidEnvironmentTransition("quarantined", "active")).toBe(false);
  });

  test("terminal states are absorbing", () => {
    expect(TERMINAL_ENVIRONMENT_STATES.has("closed")).toBe(true);
    expect(TERMINAL_ENVIRONMENT_STATES.has("quarantined")).toBe(true);
    for (const to of ENVIRONMENT_STATES) {
      expect(isValidEnvironmentTransition("closed", to)).toBe(false);
      expect(isValidEnvironmentTransition("quarantined", to)).toBe(false);
    }
  });

  test("confidence ordering with unknown at the bottom", () => {
    expect(confidenceAtLeast("high", "medium")).toBe(true);
    expect(confidenceAtLeast("medium", "low")).toBe(true);
    expect(confidenceAtLeast("low", "medium")).toBe(false);
    expect(confidenceAtLeast("unknown", "low")).toBe(false);
    expect(confidenceAtLeast("high", "unknown")).toBe(true);
  });

  test("observation staleness is time arithmetic, never a guess", () => {
    const base = { capturedAt: 1_000_000, staleAfterMs: 30_000 };
    expect(isObservationStale(base, 1_010_000)).toBe(false);
    expect(isObservationStale(base, 1_031_000)).toBe(true);
  });

  test("coordinate target REQUIRES evidence; semantic target requires evidence too", () => {
    expect(TargetIdentitySchema.safeParse({ kind: "coordinate", x: 10, y: 20 }).success).toBe(false);
    expect(
      TargetIdentitySchema.safeParse({ kind: "coordinate", x: 10, y: 20, evidence: "obs_1" }).success,
    ).toBe(true);
    expect(
      TargetIdentitySchema.safeParse({ kind: "semantic", selector: "#ok", evidence: "dom query" }).success,
    ).toBe(true);
    expect(TargetIdentitySchema.safeParse({ kind: "semantic" }).success).toBe(false);
  });

  test("request schema validates a full browser action request", () => {
    const res = EnvironmentActionRequestSchema.safeParse({
      environment: "browser",
      action: { type: "browser", op: "goto", value: "https://example.com" },
      target: { kind: "resource", path: "https://example.com" },
      confidence: "high",
      sourceActor: "cli",
    });
    expect(res.success).toBe(true);
  });

  test("request schema rejects unknown action types (closed union)", () => {
    const res = EnvironmentActionRequestSchema.safeParse({
      environment: "desktop",
      action: { type: "shell_exec", cmd: "rm -rf /" },
      target: { kind: "none" },
    });
    expect(res.success).toBe(false);
  });

  test("default session policy fails closed on private networks and cloud", () => {
    const p = defaultEnvironmentPolicy("/tmp/xr", "env_test_1");
    expect(p.blockPrivateNetworks).toBe(true);
    expect(p.allowCloudVision).toBe(false);
    expect(p.allowCloudStt).toBe(false);
    expect(p.credentialMode).toBe("none");
    expect(p.downloadsRoot).toContain("env_test_1");
  });

  test("observation carries no raw media — artifact is path+hash+bytes only", () => {
    const obs: EnvironmentObservation = {
      observationId: "obs_x",
      source: "screen",
      summary: "test",
      confidence: "high",
      provenance: "screenshot",
      artifact: { path: "/tmp/a.png", sha256: "ab".repeat(32), bytes: 1234 },
      sensitivity: "private",
      capturedAt: Date.now(),
      staleAfterMs: 30_000,
    };
    const json = JSON.parse(JSON.stringify(obs));
    expect(Object.keys(json.artifact).sort()).toEqual(["bytes", "path", "sha256"]);
    expect(json.base64).toBeUndefined();
  });
});
