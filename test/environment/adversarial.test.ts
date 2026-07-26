/**
 * XR 5.1 — Environment security/adversarial tests (§10).
 *
 * Cases: credential/cookie leakage, cloud vision consent, voice approval
 * bypass, prompt/visual instruction injection framing, path handling, stale
 * observations, sandbox posture, and structural boundary guarantees.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Store } from "../../src/state/workspace-store.ts";

const COMPUTER_USE_SRC = readFileSync(join(import.meta.dir, "../../src/control/computer-use.ts"), "utf8");
const SERVICE_SRC = readFileSync(join(import.meta.dir, "../../src/environment/service.ts"), "utf8");
const VISION_SRC = readFileSync(join(import.meta.dir, "../../src/control/vision.ts"), "utf8");
const BROWSER_SRC = readFileSync(join(import.meta.dir, "../../src/control/browser.ts"), "utf8");

let svc: typeof import("../../src/environment/service.ts");
let visionProviderMod: typeof import("../../src/environment/providers/vision.ts");
let fsProvider: typeof import("../../src/environment/providers/filesystem.ts");
let voiceGate: typeof import("../../src/environment/providers/voice.ts");
let vision: typeof import("../../src/control/vision.ts");

let tmp: string;
const auditEvents: { event: string; detail: Record<string, unknown> }[] = [];
const store = {
  audit: (event: string, detail: Record<string, unknown>) => {
    auditEvents.push({ event, detail });
  },
} as unknown as Store;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "xr-envadv-test-"));
  process.env.XR_HOME = join(tmp, "xrhome");
  process.env.HOME = tmp;
  process.env.XR_CONTROL_FORCE_TEST = "1";
  mkdirSync(process.env.XR_HOME, { recursive: true });
  svc = await import("../../src/environment/service.ts");
  visionProviderMod = await import("../../src/environment/providers/vision.ts");
  fsProvider = await import("../../src/environment/providers/filesystem.ts");
  voiceGate = await import("../../src/environment/providers/voice.ts");
  vision = await import("../../src/control/vision.ts");
});

afterAll(() => {
  delete process.env.XR_CONTROL_FORCE_TEST;
  rmSync(tmp, { recursive: true, force: true });
});

describe("cloud vision consent (no silent image transfer)", () => {
  test("routing blocks cloud vision without settings consent", () => {
    const d = visionProviderMod.decideVisionRouting({
      providerIsLocal: false,
      settingsAllowCloud: false,
      sessionPolicyAllowCloud: true,
    });
    expect(d.route).toBe("blocked");
    expect(d.reason).toContain("not enabled in settings");
  });

  test("session policy can never widen cloud consent beyond settings", () => {
    const d = visionProviderMod.decideVisionRouting({
      providerIsLocal: false,
      settingsAllowCloud: true,
      sessionPolicyAllowCloud: false,
    });
    expect(d.route).toBe("blocked");
  });

  test("local providers route locally without any consent ceremony", () => {
    const d = visionProviderMod.decideVisionRouting({
      providerIsLocal: true,
      settingsAllowCloud: false,
      sessionPolicyAllowCloud: false,
    });
    expect(d.route).toBe("local");
  });

  test("cloudVision refuses when the caller declares no consent decision", async () => {
    const fake = {
      chat: async () => ({ message: "should never reach" }),
      supportsVision: () => true,
      isLocal: () => false,
    };
    const out = await vision.cloudVision(fake as never, "task", "aGVsbG8=");
    expect(out).toContain("Vision blocked");
    const out2 = await vision.cloudVision(fake as never, "task", "aGVsbG8=", { cloudAllowed: false, providerIsLocal: false });
    expect(out2).toContain("explicit consent");
  });

  test("declared consent + local provider reaches the model", async () => {
    const fake = {
      chat: async () => ({ message: "DONE: ok" }),
      supportsVision: () => true,
      isLocal: () => true,
    };
    const out = await vision.cloudVision(fake as never, "task", "aGVsbG8=", { cloudAllowed: false, providerIsLocal: true });
    expect(out).toBe("DONE: ok");
  });

  test("vision source enforces explicit-consent semantics and size caps", () => {
    expect(VISION_SRC).toContain("cloudAllowed");
    expect(VISION_SRC).toContain("XR_VISION_MAX_IMAGE_BYTES");
    expect(VISION_SRC).toContain("exceeds vision limit");
  });
});

describe("voice is not an approval bypass (§7.5/§11)", () => {
  test("never-execute-risky blocks every non-safe action from voice", () => {
    for (const action of [
      { type: "click", x: 1, y: 2, button: "left" },
      { type: "key", keys: ["enter"] },
      { type: "type", text: "hello" },
    ] as const) {
      const d = voiceGate.gateVoiceControlAction({
        confidence: 0.99,
        confirmationPolicy: "never-execute-risky",
        action: action as never,
        approvalStrength: "standard",
      });
      expect(d.allowed).toBe(false);
      expect(d.spokenRefusal).toContain("text mode");
    }
  });

  test("strong-approval actions from voice require the text/dashboard channel", () => {
    const d = voiceGate.gateVoiceControlAction({
      confidence: 0.99,
      confirmationPolicy: "always-risky",
      action: { type: "file", op: "delete", path: "/tmp/x" } as never,
      approvalStrength: "strong",
    });
    expect(d.allowed).toBe(true);
    expect(d.requiresTextChannelApproval).toBe(true);
  });

  test("voice-sourced service runs carry voice provenance (auditable, never trusted more)", async () => {
    const res = await svc.runEnvironmentAction(
      store,
      {
        environment: "desktop",
        action: { type: "wait_ms", ms: 100 },
        target: { kind: "none" },
        sourceActor: "voice",
        dryRun: true,
      },
      { voice: { confidence: 0.9, confirmationPolicy: "always-risky" } },
    );
    expect(res.record.sourceActor).toBe("voice");
    expect(res.record.outcome).toBe("succeeded");
    const evt = [...auditEvents].reverse().find((e) => e.event === "env.action.assessed");
    expect(evt?.detail.sourceActor).toBe("voice");
  });
});

describe("prompt / visual instruction injection", () => {
  test("computer-use prompt frames screenshots as UNTRUSTED content", () => {
    expect(COMPUTER_USE_SRC).toContain("UNTRUSTED environment content");
    expect(COMPUTER_USE_SRC).toContain("NOT an instruction from the user");
  });

  test("computer-use executes steps ONLY through the governed environment gate", () => {
    expect(COMPUTER_USE_SRC).toContain("runEnvironmentAction");
    // Raw executor import is gone from the loop path.
    expect(COMPUTER_USE_SRC).not.toMatch(/import \{ execute \} from "\.\/executor\.ts"/);
  });

  test("computer-use has bounded failure behavior (no endless mutation)", () => {
    expect(COMPUTER_USE_SRC).toContain("MAX_CONSECUTIVE_PARSE_FAILURES");
    expect(COMPUTER_USE_SRC).toContain("circuitOpenUntil");
    expect(COMPUTER_USE_SRC).toContain("computer_use.denied");
  });

  test("the environment service has no private execution path — everything goes through runAction", () => {
    expect(SERVICE_SRC).toContain('import { runAction } from "../control/service.ts"');
    expect(SERVICE_SRC).not.toContain('from "../control/executor.ts"');
  });
});

describe("browser sandbox posture in the session layer", () => {
  test("governed sessions reuse the hardened launch path (sandbox on by default)", () => {
    const section = BROWSER_SRC.slice(BROWSER_SRC.indexOf("Governed isolated browser sessions"));
    expect(section).toContain("getSecureBrowserArgs()");
    expect(section).toContain("chromiumSandbox: true");
    expect(section).toContain("shouldAllowNoSandbox()");
    expect(section).toContain("ignoreHTTPSErrors: false");
  });

  test("sessions never import or export cookies/storage state", () => {
    const section = BROWSER_SRC.slice(BROWSER_SRC.indexOf("Governed isolated browser sessions"));
    expect(section).not.toContain("storageState");
    expect(section).not.toContain("context.cookies");
    expect(section).not.toContain("addCookies");
  });
});

describe("filesystem boundary + compensation", () => {
  test("writes capture a pre-image; deletes never fake one", async () => {
    const file = join(tmp, "pre.txt");
    writeFileSync(file, "original");
    const pre = await fsProvider.capturePreImage({ type: "file", op: "write", path: file, content: "new" }, tmp);
    expect(pre?.kind).toBe("file_content");
    expect(pre?.content).toBe("original");
    const del = await fsProvider.capturePreImage({ type: "file", op: "delete", path: file }, tmp);
    expect(del).toBeNull();
  });

  test("move captures a backward-compensation description", async () => {
    const pre = await fsProvider.capturePreImage({ type: "file", op: "move", path: "a.txt", targetPath: "b.txt" }, tmp);
    expect(fsProvider.describeCompensation(pre!)).toContain("back to");
  });

  test("workspace containment reporting (used for visibility, not silent widening)", () => {
    expect(fsProvider.isInsideWorkspace("src/index.ts", "/ws/proj")).toBe(true);
    expect(fsProvider.isInsideWorkspace("../../etc/passwd", "/ws/proj")).toBe(false);
  });
});

describe("stale observation protection on destructive classes", () => {
  test("a stale observation can never justify a coordinate action", async () => {
    // drag_drop is coordinate + unknown→irreversible-adjacent: gate must block.
    const staleId = "obs_adv_stale";
    const { environmentObservations } = await import("../../src/environment/observations.ts");
    environmentObservations.put({
      observationId: staleId,
      source: "screen",
      summary: "old capture",
      confidence: "high",
      provenance: "screenshot",
      sensitivity: "private",
      capturedAt: Date.now() - 300_000,
      staleAfterMs: 30_000,
    });
    const res = await svc.runEnvironmentAction(store, {
      environment: "desktop",
      action: { type: "drag_drop", x1: 1, y1: 2, x2: 3, y2: 4 },
      target: { kind: "coordinate", x: 1, y: 2, evidence: staleId },
      observationRef: staleId,
      confidence: "high",
      dryRun: true,
    });
    expect(res.record.outcome).toBe("blocked");
    expect(res.record.message).toContain("stale");
  });

  test("an unknown observation reference is blocked (no fabricated perception)", async () => {
    const res = await svc.runEnvironmentAction(store, {
      environment: "desktop",
      action: { type: "click", x: 5, y: 5, button: "left" },
      target: { kind: "coordinate", x: 5, y: 5, evidence: "obs_nonexistent" },
      observationRef: "obs_nonexistent",
      confidence: "high",
      dryRun: true,
    });
    expect(res.record.outcome).toBe("blocked");
    expect(res.record.message).toContain("unknown observation");
  });
});
