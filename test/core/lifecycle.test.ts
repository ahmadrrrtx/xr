/**
 * XR 4.0 — Lifecycle Manager Tests
 *
 * Tests the enhanced lifecycle state machine with explicit transitions,
 * idempotent operations, and failure handling.
 */

import { describe, test, expect } from "bun:test";
import { LifecycleManager, RuntimeState } from "../../src/core/lifecycle.ts";
import { LifecycleTransitionError, LifecycleHookFailedError } from "../../src/core/errors.ts";
import { EventBus } from "../../src/core/event-bus.ts";

describe("LifecycleManager", () => {
  test("starts in UNINITIALIZED state", () => {
    const lm = new LifecycleManager();
    expect(lm.getState()).toBe(RuntimeState.UNINITIALIZED);
    expect(lm.isRunning()).toBe(false);
    expect(lm.isOperational()).toBe(false);
    expect(lm.isTransitioning()).toBe(false);
  });

  test("init() transitions UNINITIALIZED → BOOTSTRAPPING → READY", async () => {
    const lm = new LifecycleManager();
    await lm.init();
    expect(lm.getState()).toBe(RuntimeState.READY);
    expect(lm.isRunning()).toBe(false);
    expect(lm.isOperational()).toBe(false);
  });

  test("init() is idempotent when already READY", async () => {
    const lm = new LifecycleManager();
    await lm.init();
    expect(lm.getState()).toBe(RuntimeState.READY);
    // Call again — should not throw
    await lm.init();
    expect(lm.getState()).toBe(RuntimeState.READY);
  });

  test("init() is idempotent when already RUNNING", async () => {
    const lm = new LifecycleManager();
    await lm.init();
    await lm.start();
    expect(lm.getState()).toBe(RuntimeState.RUNNING);
    // Call again — should not throw
    await lm.init();
    expect(lm.getState()).toBe(RuntimeState.RUNNING);
  });

  test("start() transitions READY → STARTING → RUNNING", async () => {
    const lm = new LifecycleManager();
    await lm.init();
    await lm.start();
    expect(lm.getState()).toBe(RuntimeState.RUNNING);
    expect(lm.isRunning()).toBe(true);
    expect(lm.isOperational()).toBe(true);
  });

  test("start() throws if called before init()", async () => {
    const lm = new LifecycleManager();
    await expect(lm.start()).rejects.toThrow(LifecycleTransitionError);
  });

  test("start() is idempotent when already RUNNING", async () => {
    const lm = new LifecycleManager();
    await lm.init();
    await lm.start();
    expect(lm.getState()).toBe(RuntimeState.RUNNING);
    // Call again — should not throw
    await lm.start();
    expect(lm.getState()).toBe(RuntimeState.RUNNING);
  });

  test("stop() transitions to STOPPED", async () => {
    const lm = new LifecycleManager();
    await lm.init();
    await lm.start();
    await lm.stop();
    expect(lm.getState()).toBe(RuntimeState.STOPPED);
    expect(lm.isRunning()).toBe(false);
  });

  test("stop() is idempotent when already STOPPED", async () => {
    const lm = new LifecycleManager();
    await lm.init();
    await lm.start();
    await lm.stop();
    expect(lm.getState()).toBe(RuntimeState.STOPPED);
    // Call again — should not throw
    await lm.stop();
    expect(lm.getState()).toBe(RuntimeState.STOPPED);
  });

  test("stop() from UNINITIALIZED goes to STOPPED (idempotent)", async () => {
    const lm = new LifecycleManager();
    await lm.stop();
    expect(lm.getState()).toBe(RuntimeState.STOPPED);
  });

  test("init() after stop() can re-bootstrap", async () => {
    const lm = new LifecycleManager();
    await lm.init();
    await lm.start();
    await lm.stop();
    expect(lm.getState()).toBe(RuntimeState.STOPPED);
    await lm.init();
    expect(lm.getState()).toBe(RuntimeState.READY);
  });

  test("init() with a failing participant sets FAILED state", async () => {
    const lm = new LifecycleManager();
    lm.setParticipants([
      {
        name: "good-service",
        hook: { onInit: async () => {} },
      },
      {
        name: "bad-service",
        hook: { onInit: async () => { throw new Error("init boom"); } },
      },
    ]);
    await expect(lm.init()).rejects.toThrow(LifecycleHookFailedError);
    expect(lm.getState()).toBe(RuntimeState.FAILED);
  });

  test("start() with a failing participant sets FAILED state", async () => {
    const lm = new LifecycleManager();
    lm.setParticipants([
      {
        name: "good-service",
        hook: { onInit: async () => {}, onStart: async () => {} },
      },
      {
        name: "bad-service",
        hook: { onInit: async () => {}, onStart: async () => { throw new Error("start boom"); } },
      },
    ]);
    await lm.init();
    expect(lm.getState()).toBe(RuntimeState.READY);
    await expect(lm.start()).rejects.toThrow(LifecycleHookFailedError);
    expect(lm.getState()).toBe(RuntimeState.FAILED);
  });

  test("stop() with a failing participant continues (fail-soft) and reaches STOPPED", async () => {
    const lm = new LifecycleManager();
    lm.setParticipants([
      {
        name: "good-service",
        hook: { onInit: async () => {}, onStart: async () => {}, onStop: async () => {} },
      },
      {
        name: "bad-service",
        hook: { onInit: async () => {}, onStart: async () => {}, onStop: async () => { throw new Error("stop boom"); } },
      },
    ]);
    await lm.init();
    await lm.start();
    // stop() should not throw even though bad-service onStop fails
    await lm.stop();
    expect(lm.getState()).toBe(RuntimeState.STOPPED);
  });

  test("stop() runs hooks in reverse order", async () => {
    const order: string[] = [];
    const lm = new LifecycleManager();
    lm.setParticipants([
      {
        name: "first",
        hook: {
          onInit: async () => {},
          onStart: async () => {},
          onStop: async () => { order.push("first-stop"); },
        },
      },
      {
        name: "second",
        hook: {
          onInit: async () => {},
          onStart: async () => {},
          onStop: async () => { order.push("second-stop"); },
        },
      },
    ]);
    await lm.init();
    await lm.start();
    await lm.stop();
    // Reverse order: second stops first
    expect(order).toEqual(["second-stop", "first-stop"]);
  });

  test("enterWorkspaceSwitch() validates transition from RUNNING", async () => {
    const lm = new LifecycleManager();
    await lm.init();
    await lm.start();
    lm.enterWorkspaceSwitch();
    expect(lm.getState()).toBe(RuntimeState.SWITCHING_WORKSPACE);
    expect(lm.isTransitioning()).toBe(true);
  });

  test("exitWorkspaceSwitch(true) returns to RUNNING", async () => {
    const lm = new LifecycleManager();
    await lm.init();
    await lm.start();
    lm.enterWorkspaceSwitch();
    lm.exitWorkspaceSwitch(true);
    expect(lm.getState()).toBe(RuntimeState.RUNNING);
  });

  test("exitWorkspaceSwitch(false) enters FAILED", async () => {
    const lm = new LifecycleManager();
    await lm.init();
    await lm.start();
    lm.enterWorkspaceSwitch();
    lm.exitWorkspaceSwitch(false);
    expect(lm.getState()).toBe(RuntimeState.FAILED);
  });

  test("markDegraded() enters DEGRADED state", async () => {
    const lm = new LifecycleManager();
    await lm.init();
    await lm.start();
    lm.markDegraded("optional service unavailable");
    expect(lm.getState()).toBe(RuntimeState.DEGRADED);
    expect(lm.isRunning()).toBe(true); // DEGRADED is still operational
    expect(lm.isOperational()).toBe(true);
  });

  test("recoverFromDegraded() returns to RUNNING", async () => {
    const lm = new LifecycleManager();
    await lm.init();
    await lm.start();
    lm.markDegraded();
    lm.recoverFromDegraded();
    expect(lm.getState()).toBe(RuntimeState.RUNNING);
  });

  test("reset() returns to UNINITIALIZED", async () => {
    const lm = new LifecycleManager();
    await lm.init();
    await lm.start();
    await lm.stop();
    lm.reset();
    expect(lm.getState()).toBe(RuntimeState.UNINITIALIZED);
  });

  test("invalid transition throws LifecycleTransitionError", async () => {
    const lm = new LifecycleManager();
    // Cannot start from UNINITIALIZED
    await expect(lm.start()).rejects.toThrow(LifecycleTransitionError);
  });

  test("getHookResults() tracks successful and failed hooks", async () => {
    const lm = new LifecycleManager();
    lm.setParticipants([
      {
        name: "good",
        hook: { onInit: async () => {} },
      },
      {
        name: "bad",
        hook: { onInit: async () => { throw new Error("fail"); } },
      },
    ]);
    await expect(lm.init()).rejects.toThrow();
    const results = lm.getHookResults();
    expect(results.length).toBe(2);
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.service).toBe("good");
    expect(results[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(results[1]?.success).toBe(false);
    expect(results[1]?.service).toBe("bad");
    expect(results[1]?.error).toContain("fail");
  });

  test("lifecycle events are emitted on state changes", async () => {
    const events = new EventBus();
    const stateChanges: string[] = [];
    events.on("lifecycle.state_changed", (payload: any) => {
      stateChanges.push(`${payload.previousState}→${payload.nextState}`);
    });
    const lm = new LifecycleManager(events);
    await lm.init();
    expect(stateChanges).toContain("UNINITIALIZED→BOOTSTRAPPING");
    expect(stateChanges).toContain("BOOTSTRAPPING→READY");
  });

  test("lifecycle events include hook results", async () => {
    const events = new EventBus();
    const hookEvents: string[] = [];
    events.on("lifecycle.hook.started", (p: any) => { hookEvents.push(`start:${p.service}`); });
    events.on("lifecycle.hook.completed", (p: any) => { hookEvents.push(`done:${p.service}`); });
    const lm = new LifecycleManager(events);
    lm.setParticipants([{ name: "test-svc", hook: { onInit: async () => {} } }]);
    await lm.init();
    expect(hookEvents).toContain("start:test-svc");
    expect(hookEvents).toContain("done:test-svc");
  });

  test("participantCount tracks the number of participants", () => {
    const lm = new LifecycleManager();
    expect(lm.participantCount).toBe(0);
    lm.setParticipants([
      { name: "a", hook: {} },
      { name: "b", hook: {} },
    ]);
    expect(lm.participantCount).toBe(2);
  });
});
