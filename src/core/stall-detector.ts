/**
 * XR Phase 3 · T3 — Event-loop stall detection.
 *
 * Article XII · Rule 4: "No synchronous I/O on hot paths; event-loop stalls
 * are a defect." Synchronous work that blocks the event loop (sync FS, CPU
 * loops, sync network) shows up as a heartbeat gap. This monitor:
 *
 *   - ticks every `heartbeatMs` while attached;
 *   - if the loop was blocked longer than `stallThresholdMs`, records a
 *     stall {durationMs, at} and emits an event;
 *   - at shutdown (or via snapshot()) reports the stalls so a caller can
 *     decide policy (warn, fail a test, surface in health).
 *
 * It is opt-in per process: XRApp attaches it at start() (CLI commands,
 * daemon, shell all go through XRApp) and detaches at shutdown(). Tests can
 * construct one directly with a small threshold and a synthetic blocking
 * loop to assert detection.
 *
 * The monitor itself uses only timers (never I/O), so it can never stall the
 * loop it is watching.
 */

import type { EventBus } from "./event-bus.ts";

export interface StallRecord {
  /** Measured loop-blocked duration, ms. */
  durationMs: number;
  at: number;
}

export interface StallDetectorOptions {
  /** How often the heartbeat ticks (default 100 ms). */
  heartbeatMs?: number;
  /** A heartbeat gap above this (ms) is recorded as a stall (default 200). */
  stallThresholdMs?: number;
  /** Emit `stall.detected` events on the kernel event bus when provided. */
  events?: EventBus;
}

export class StallDetector {
  private readonly heartbeatMs: number;
  private readonly stallThresholdMs: number;
  private readonly events?: EventBus;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private readonly stalls: StallRecord[] = [];
  private attached = false;

  constructor(opts: StallDetectorOptions = {}) {
    this.heartbeatMs = opts.heartbeatMs ?? 100;
    this.stallThresholdMs = opts.stallThresholdMs ?? 200;
    this.events = opts.events;
  }

  /** Start monitoring. Idempotent. */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.lastTick = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      const gap = now - this.lastTick;
      this.lastTick = now;
      if (gap > this.stallThresholdMs) {
        const record: StallRecord = { durationMs: Math.round(gap), at: Date.now() };
        this.stalls.push(record);
        try {
          this.events?.emit("stall.detected" as never, { ...record } as never);
        } catch {
          /* stall reporting must never break the loop */
        }
      }
    }, this.heartbeatMs);
    // Never keep a process alive just to watch it.
    if (this.timer.unref) this.timer.unref();
  }

  /** Stop monitoring. Idempotent. */
  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Stall records so far (longest first). */
  stallsSeen(): StallRecord[] {
    return [...this.stalls].sort((a, b) => b.durationMs - a.durationMs);
  }

  get isAttached(): boolean {
    return this.attached;
  }

  /**
   * Assertion helper for tests/CI: returns the stalls that exceed the
   * threshold. A golden-path run must report zero.
   */
  violations(thresholdMs = this.stallThresholdMs): StallRecord[] {
    return this.stallsSeen().filter((s) => s.durationMs >= thresholdMs);
  }
}
