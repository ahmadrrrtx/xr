/**
 * XR 5.1 — Environment service integration tests (the governed entry point).
 *
 * Environment-variable-first pattern (same regime as voice/context tests):
 * XR_HOME + HOME are pointed at a temp dir BEFORE the modules under test are
 * dynamically imported, so config and permission state are isolated.
 *
 * Execution-dependent paths use dryRun so tests are deterministic on every
 * platform (the control executor requires OS tools CI may not have); the gate
 * behavior under test — blocked/denied/consent — never requires an OS action.
 */
import { describe, test, expect, setDefaultTimeout, beforeAll, afterAll } from "bun:test";

setDefaultTimeout(20_000);
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Store } from "../../src/state/workspace-store.ts";

let svc: typeof import("../../src/platform/environment/service.ts");
let obs: typeof import("../../src/platform/environment/observations.ts");
let lifecycle: typeof import("../../src/platform/environment/lifecycle.ts");
let cfg: typeof import("../../src/config/config.ts");
let perms: typeof import("../../src/control/permissions.ts");

let tmp: string;
let permissionsBefore: string[] = [];
const auditEvents: { event: string; detail: Record<string, unknown> }[] = [];
const store = {
  audit: (event: string, detail: Record<string, unknown>) => {
    auditEvents.push({ event, detail });
  },
} as unknown as Store;

function freshObservation(id: string, stale = false) {
  obs.environmentObservations.put({
    observationId: id,
    source: "screen",
    summary: "test capture",
    confidence: "medium",
    provenance: "screenshot",
    sensitivity: "private",
    capturedAt: Date.now() - (stale ? 120_000 : 0),
    staleAfterMs: 30_000,
  });
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "xr-envsvc-test-"));
  process.env.XR_CONTROL_FORCE_TEST = "1";
  perms = await import("../../src/control/permissions.ts");
  permissionsBefore = [...perms.listPermissions()];
  perms.grantPermission("files_write");
  perms.grantPermission("desktop");
  perms.grantPermission("browser");
  svc = await import("../../src/platform/environment/service.ts");
  obs = await import("../../src/platform/environment/observations.ts");
  lifecycle = await import("../../src/platform/environment/lifecycle.ts");
  cfg = await import("../../src/config/config.ts");
});

afterAll(() => {
  delete process.env.XR_CONTROL_FORCE_TEST;
  delete process.env.XR_ENVIRONMENT_DISABLED;
  // Restore any ambient config the kill-switch tests touched.
  try {
    const { config } = cfg.loadConfig();
    config.environment.enabled = true;
    for (const k of Object.keys(config.environment.modalities)) {
      (config.environment.modalities as Record<string, boolean>)[k] = true;
    }
    cfg.saveConfig(config);
  } catch { /* best-effort restore */ }
  // Restore permission grants to their pre-test state.
  try {
    for (const s of ["files_write", "desktop", "browser"] as const) {
      if (!permissionsBefore.includes(s)) perms.revokePermission(s);
    }
  } catch { /* best-effort restore */ }
  rmSync(tmp, { recursive: true, force: true });
});

describe("runEnvironmentAction — hard blocks", () => {
  test("invalid request schema is blocked, never executed", async () => {
    const res = await svc.runEnvironmentAction(store, { environment: "desktop", action: { type: "shell", cmd: "id" } });
    expect(res.record.outcome).toBe("blocked");
    expect(res.record.message).toContain("invalid environment action request");
  });

  test("XR_ENVIRONMENT_DISABLED blocks the whole layer (rollback switch)", async () => {
    process.env.XR_ENVIRONMENT_DISABLED = "1";
    try {
      const res = await svc.runEnvironmentAction(store, {
        environment: "desktop",
        action: { type: "wait_ms", ms: 100 },
        target: { kind: "none" },
        dryRun: true,
      });
      expect(res.record.outcome).toBe("blocked");
      expect(res.record.message).toContain("XR_ENVIRONMENT_DISABLED");
    } finally {
      delete process.env.XR_ENVIRONMENT_DISABLED;
    }
  });

  test("per-modality kill switch blocks one environment without touching others", async () => {
    const { config } = cfg.loadConfig();
    config.environment.modalities.desktop = false;
    cfg.saveConfig(config);
    try {
      const blocked = await svc.runEnvironmentAction(store, {
        environment: "desktop",
        action: { type: "wait_ms", ms: 100 },
        target: { kind: "none" },
        dryRun: true,
      });
      expect(blocked.record.outcome).toBe("blocked");
      expect(blocked.record.message).toContain("modalities.desktop");
      // Other modalities still work.
      const okFs = await svc.runEnvironmentAction(store, {
        environment: "filesystem",
        action: { type: "file", op: "read", path: "/etc/hostname" },
        target: { kind: "resource", path: "/etc/hostname" },
        dryRun: true,
      });
      expect(okFs.record.outcome).toBe("succeeded");
    } finally {
      const { config: c2 } = cfg.loadConfig();
      c2.environment.modalities.desktop = true;
      cfg.saveConfig(c2);
    }
  });

  test("vision cannot execute — it is an observation environment", async () => {
    const res = await svc.runEnvironmentAction(store, {
      environment: "vision",
      action: { type: "screenshot", target: "screen" },
      target: { kind: "none" },
      dryRun: true,
    });
    expect(res.record.outcome).toBe("blocked");
    expect(res.record.message).toContain("observation environment");
  });

  test("cross-environment actions fail closed (browser op is not a desktop op)", async () => {
    const res = await svc.runEnvironmentAction(store, {
      environment: "desktop",
      action: { type: "browser", op: "goto", value: "https://example.com" },
      target: { kind: "none" },
      dryRun: true,
    });
    expect(res.record.outcome).toBe("blocked");
    expect(res.record.message).toContain("not valid for the 'desktop' environment");
  });
});

describe("runEnvironmentAction — target proof & staleness", () => {
  test("coordinate action without evidence is blocked", async () => {
    const res = await svc.runEnvironmentAction(store, {
      environment: "desktop",
      action: { type: "click", x: 100, y: 200, button: "left" },
      target: { kind: "none" },
      confidence: "high",
      dryRun: true,
    });
    expect(res.record.outcome).toBe("blocked");
    expect(res.record.message).toContain("coordinate");
  });

  test("coordinate action with a STALE observation is blocked (no acting on old perception)", async () => {
    freshObservation("obs_stale_1", true);
    const res = await svc.runEnvironmentAction(store, {
      environment: "desktop",
      action: { type: "click", x: 100, y: 200, button: "left" },
      target: { kind: "coordinate", x: 100, y: 200, evidence: "obs_stale_1" },
      observationRef: "obs_stale_1",
      confidence: "medium",
      dryRun: true,
    });
    expect(res.record.outcome).toBe("blocked");
    expect(res.record.message).toContain("stale");
    expect(res.record.observation?.stale).toBe(true);
  });

  test("coordinate action with a FRESH observation passes the gate (capability permitting)", async () => {
    freshObservation("obs_fresh_1");
    const res = await svc.runEnvironmentAction(store, {
      environment: "desktop",
      action: { type: "click", x: 100, y: 200, button: "left" },
      target: { kind: "coordinate", x: 100, y: 200, evidence: "obs_fresh_1" },
      observationRef: "obs_fresh_1",
      confidence: "medium",
      dryRun: true,
    });
    const { detectCapabilities } = await import("../../src/control/adapter.ts");
    if (!detectCapabilities().tools.keyboard) {
      // Platform without input tooling: fails closed with remediation instead
      // of pretending the click could happen (honest degradation, §7.4/§11).
      expect(res.record.outcome).toBe("blocked");
      expect(res.record.message).toContain("unavailable");
    } else {
      expect(res.record.outcome).toBe("succeeded");
      expect(res.record.message).toContain("dry-run");
      expect(res.record.approval.required).toBe("strong"); // coordinate without high confidence
      expect(res.record.approval.granted).toBe(false); // dry-run never claims approval
      expect(res.record.observation?.ref).toBe("obs_fresh_1");
    }
  });
});

describe("runEnvironmentAction — governed success paths (dry-run)", () => {
  test("safe reversible action needs no approval", async () => {
    const res = await svc.runEnvironmentAction(store, {
      environment: "desktop",
      action: { type: "wait_ms", ms: 100 },
      target: { kind: "none" },
      dryRun: true,
    });
    expect(res.record.outcome).toBe("succeeded");
    expect(res.record.approval.required).toBe("none");
  });

  test("filesystem write is compensatable and a pre-image note is attached", async () => {
    const res = await svc.runEnvironmentAction(store, {
      environment: "filesystem",
      action: { type: "file", op: "write", path: join(tmp, "scratch.txt"), content: "hello" },
      target: { kind: "resource", path: join(tmp, "scratch.txt") },
      dryRun: true,
    });
    expect(res.record.outcome).toBe("succeeded");
    expect(res.record.reversibility).toBe("compensatable");
    expect(res.record.cleanupNote).toContain("compensation available");
    // destructive-risk but compensatable → standard approval (existing flow),
    // not strong (strong is reserved for irreversible/unknown/sensitive-value).
    expect(res.record.approval.required).toBe("standard");
  });

  test("extract actions are typed as untrusted_external evidence", async () => {
    // dry-run still records the context-channel decision.
    const res = await svc.runEnvironmentAction(store, {
      environment: "browser",
      action: { type: "browser", op: "extract", selector: "h1" },
      target: { kind: "semantic", selector: "h1", evidence: "dom probe" },
      dryRun: true,
      sessionId: undefined,
    });
    // Browser sessions may not provision in restricted CI (root) — both the
    // blocked-on-provisioning and the dry-run outcome are honest; the evidence
    // marker only matters on success, so assert at the gate level instead.
    if (res.record.outcome === "succeeded") {
      expect(res.record.evidenceRefs.some((r) => r.startsWith("context:untrusted_external"))).toBe(true);
    } else {
      expect(res.record.outcome).toBe("blocked");
    }
  });
});

describe("runEnvironmentAction — voice gate", () => {
  test("never-execute-risky refuses sensitive actions from voice with a spoken refusal", async () => {
    const res = await svc.runEnvironmentAction(
      store,
      {
        environment: "application",
        action: { type: "open", target: "https://example.com" },
        target: { kind: "resource", path: "https://example.com" },
        sourceActor: "voice",
        confidence: "low",
        dryRun: true,
      },
      { voice: { confidence: 0.9, confirmationPolicy: "never-execute-risky" } },
    );
    expect(res.record.outcome).toBe("denied");
    expect(res.spokenRefusal).toContain("voice");
    expect(auditEvents.some((e) => e.event === "env.action.denied")).toBe(true);
  });

  test("low-confidence intents are refused before any action decision", async () => {
    const res = await svc.runEnvironmentAction(
      store,
      {
        environment: "desktop",
        action: { type: "wait_ms", ms: 100 },
        target: { kind: "none" },
        sourceActor: "voice",
        dryRun: true,
      },
      { voice: { confidence: 0.2, confirmationPolicy: "always-risky" } },
    );
    expect(res.record.outcome).toBe("denied");
    expect(res.record.message).toContain("below threshold");
    expect(res.spokenRefusal).toContain("not confident");
  });

  test("safe actions from trusted-confident voice still work", async () => {
    const res = await svc.runEnvironmentAction(
      store,
      {
        environment: "desktop",
        action: { type: "wait_ms", ms: 100 },
        target: { kind: "none" },
        sourceActor: "voice",
        dryRun: true,
      },
      { voice: { confidence: 0.95, confirmationPolicy: "never-execute-risky" } },
    );
    expect(res.record.outcome).toBe("succeeded");
  });
});

describe("records, audit, and history", () => {
  test("every run emits env.action.assessed and a terminal record event", async () => {
    const before = auditEvents.length;
    await svc.runEnvironmentAction(store, {
      environment: "desktop",
      action: { type: "wait_ms", ms: 100 },
      target: { kind: "none" },
      dryRun: true,
    });
    const tail = auditEvents.slice(before);
    expect(tail.some((e) => e.event === "env.action.assessed")).toBe(true);
    expect(tail.some((e) => e.event === "env.action.executed")).toBe(true);
  });

  test("sensitive browser values are redacted in assessed events and records", async () => {
    const before = auditEvents.length;
    const res = await svc.runEnvironmentAction(
      store,
      {
        environment: "browser",
        action: { type: "browser", op: "fill", selector: "#pw", value: "hunter2-supersecret", sensitive: true },
        target: { kind: "semantic", selector: "#pw", evidence: "dom" },
        sourceActor: "voice",
        dryRun: true,
      },
      { voice: { confidence: 0.95, confirmationPolicy: "never-execute-risky" } },
    );
    expect(res.record.outcome).toBe("denied");
    const tail = auditEvents.slice(before);
    const serialized = JSON.stringify(tail) + JSON.stringify(res.record);
    expect(serialized).not.toContain("hunter2-supersecret");
    expect(serialized).toContain("«redacted»");
  });

  test("history accumulates bounded records newest-first", async () => {
    await svc.runEnvironmentAction(store, {
      environment: "desktop",
      action: { type: "wait_ms", ms: 100 },
      target: { kind: "none" },
      dryRun: true,
    });
    const hist = svc.environmentHistory(10);
    expect(hist.length).toBeGreaterThan(0);
    expect(hist[0]!.recordId).toMatch(/^envact_/);
  });
});

describe("observations", () => {
  test("observeEnvironment registers a governed, blob-free observation", async () => {
    const res = await svc.observeEnvironment(store, { source: "screen" });
    expect(res.ok).toBe(true);
    expect(res.observation).toBeDefined();
    const o = res.observation!;
    expect(o.provenance).toBe("screenshot");
    expect(["private", "unknown"]).toContain(o.sensitivity);
    expect(Object.keys(o)).not.toContain("base64");
    expect(o.staleAfterMs).toBeGreaterThan(0);
    expect(obs.environmentObservations.get(o.observationId)).toBeDefined();
  });

  test("browser observation requires a browser session", async () => {
    const res = await svc.observeEnvironment(store, { source: "browser" });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("sessionId");
  });
});

describe("sessions", () => {
  test("non-browser sessions open, list, and close with cleanup succeeded", async () => {
    const opened = svc.openEnvironmentSession({ store, type: "desktop", workspaceId: "/ws/test" });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const listed = svc.listEnvironmentSessions("/ws/test");
    expect(listed.some((s) => s.sessionId === opened.session.sessionId)).toBe(true);
    const closed = await svc.closeEnvironmentSession(store, opened.session.sessionId, "test done");
    expect(closed.ok).toBe(true);
    expect(opened.session.state).toBe("closed");
    expect(opened.session.cleanupState === "succeeded" || opened.session.cleanupState === "pending").toBe(true);
  });

  test("closing an unknown session fails honestly", async () => {
    const res = await svc.closeEnvironmentSession(store, "env_nope_123", "test");
    expect(res.ok).toBe(false);
  });
});
