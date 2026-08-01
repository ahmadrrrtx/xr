/**
 * XR Phase 3 · T3 — event-loop stall detection tests.
 *
 * The detector must:
 *   1. detect a synthetic event-loop block (busy-wait) above the threshold;
 *   2. stay silent on a golden path (no violations without a block);
 *   3. attach/detach cleanly (no timers leak, idempotent).
 */

import { describe, test, expect } from "bun:test";
import { StallDetector } from "../../src/core/stall-detector.ts";

function busyWait(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* burn the event loop */
  }
}

describe("Phase 3 · T3 — stall detection", () => {
  test("detects a synthetic event-loop block above the threshold", async () => {
    const detector = new StallDetector({ heartbeatMs: 10, stallThresholdMs: 50 });
    detector.attach();
    busyWait(120);
    await Bun.sleep(60);
    const violations = detector.violations(50);
    detector.detach();
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0]!.durationMs).toBeGreaterThanOrEqual(50);
  }, 10_000);

  test("golden path reports zero violations", async () => {
    const detector = new StallDetector({ heartbeatMs: 10, stallThresholdMs: 50 });
    detector.attach();
    // Let the loop breathe: async waits only.
    await Bun.sleep(150);
    const violations = detector.violations(50);
    detector.detach();
    expect(violations).toEqual([]);
  }, 10_000);

  test("detach is idempotent and stops monitoring", async () => {
    const detector = new StallDetector({ heartbeatMs: 10, stallThresholdMs: 50 });
    detector.attach();
    detector.attach(); // no-op
    detector.detach();
    detector.detach(); // no-op
    busyWait(120);
    await Bun.sleep(40);
    expect(detector.isAttached).toBe(false);
    expect(detector.stallsSeen()).toEqual([]);
  }, 10_000);

  test("XRApp attaches the detector at start() and detaches at shutdown()", async () => {
    // The kernel's stall detector is wired in app.ts; assert the plumbing.
    const { XRApp } = await import("../../src/core/app.ts");
    const app = new XRApp();
    expect(app.stallDetector.isAttached).toBe(false);
    const originalBootstrap = app.bootstrap.bind(app);
    await originalBootstrap();
    await app.start();
    expect(app.stallDetector.isAttached).toBe(true);
    await app.shutdown();
    expect(app.stallDetector.isAttached).toBe(false);
  }, 60_000);
});
