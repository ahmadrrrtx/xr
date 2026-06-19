/**
 * XR Stage 5 — Spinner / Progress subsystem
 *
 * - Claude Code–style animated spinner (star-burst frames)
 * - Progress bar with percentage
 * - Multi-step task tracker
 * - Graceful degradation for non-TTY
 */

import { A, xrCyan, xrGreen, xrAmber, xrDim, xrBold, SPINNER_FRAMES, DOTS_FRAMES, BAR_FILLED, BAR_EMPTY, BAR_HEAD } from "./theme.ts";

const isTTY = process.stdout.isTTY ?? false;

// ── Core Spinner ──────────────────────────────────────────────────────────────

export class Spinner {
  private frame   = 0;
  private timer:  ReturnType<typeof setInterval> | null = null;
  private active  = false;
  private label   = "";
  private elapsed = 0;
  private startMs = 0;

  constructor(private readonly fps = 12) {}

  start(label: string): this {
    this.label   = label;
    this.active  = true;
    this.startMs = Date.now();

    if (!isTTY) {
      process.stdout.write(`  ${label}...\n`);
      return this;
    }

    process.stdout.write(A.cursorHide);
    this.timer = setInterval(() => this._render(), 1000 / this.fps);
    return this;
  }

  update(label: string): this {
    this.label = label;
    return this;
  }

  stop(result?: "ok" | "warn" | "error", message?: string): void {
    if (!this.active) return;
    this.active = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const elapsed = ((Date.now() - this.startMs) / 1000).toFixed(1);

    if (isTTY) {
      process.stdout.write(A.clearLine);
      process.stdout.write(A.cursorShow);
    }

    if (message) {
      const icon = result === "ok"    ? xrGreen("✓")
                 : result === "warn"  ? xrAmber("!")
                 : result === "error" ? `\x1b[38;2;255;77;77m✗\x1b[0m`
                 : xrCyan("·");
      console.log(`  ${icon} ${message} ${xrDim(`(${elapsed}s)`)}`);
    }
  }

  succeed(msg: string): void { this.stop("ok",    msg); }
  warn   (msg: string): void { this.stop("warn",  msg); }
  fail   (msg: string): void { this.stop("error", msg); }

  private _render(): void {
    if (!this.active || !isTTY) return;
    const f = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];
    const elapsed = ((Date.now() - this.startMs) / 1000).toFixed(1);
    const line = `  ${xrCyan(f)} ${this.label} ${xrDim(`${elapsed}s`)}`;
    process.stdout.write(`${A.clearLine}${line}`);
    this.frame++;
  }
}

// ── Progress Bar ──────────────────────────────────────────────────────────────

export class ProgressBar {
  private current = 0;
  private timer:  ReturnType<typeof setInterval> | null = null;
  private label  = "";
  private startMs = 0;

  constructor(
    private readonly total:  number,
    private readonly width:  number = 40,
    private readonly fps:    number = 10,
  ) {}

  start(label: string): this {
    this.label   = label;
    this.startMs = Date.now();

    if (!isTTY) {
      process.stdout.write(`  ${label} [0/${this.total}]\n`);
      return this;
    }

    process.stdout.write(A.cursorHide);
    this.timer = setInterval(() => this._render(), 1000 / this.fps);
    return this;
  }

  tick(label?: string): void {
    this.current = Math.min(this.current + 1, this.total);
    if (label) this.label = label;

    if (!isTTY) {
      process.stdout.write(`  ${this.label} [${this.current}/${this.total}]\n`);
    }
  }

  finish(message?: string): void {
    this.current = this.total;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (isTTY) {
      this._render();
      process.stdout.write("\n" + A.cursorShow);
    }
    if (message) console.log(`  ${xrGreen("✓")} ${message}`);
  }

  private _render(): void {
    if (!isTTY) return;
    const pct  = this.total > 0 ? this.current / this.total : 0;
    const filled = Math.floor(pct * this.width);
    const empty  = this.width - filled - (filled < this.width ? 1 : 0);
    const bar = xrCyan(BAR_FILLED.repeat(filled))
              + (filled < this.width ? xrCyan(BAR_HEAD) : "")
              + xrDim(BAR_EMPTY.repeat(Math.max(0, empty)));
    const pctStr = `${Math.floor(pct * 100)}%`.padStart(4);
    const line   = `  [${bar}] ${xrGreen(pctStr)}  ${xrDim(this.label)}`;
    process.stdout.write(`${A.clearLine}${line}`);
  }
}

// ── Multi-Step Task Tracker ───────────────────────────────────────────────────

export type StepStatus = "pending" | "running" | "done" | "warn" | "error" | "skip";

export interface Step {
  id:      string;
  label:   string;
  status:  StepStatus;
  detail?: string;
  ms?:     number;
}

export class StepTracker {
  private steps:   Step[]  = [];
  private timer:   ReturnType<typeof setInterval> | null = null;
  private frame    = 0;
  private startMs  = Date.now();
  private rendered = 0;

  addStep(id: string, label: string): this {
    this.steps.push({ id, label, status: "pending" });
    return this;
  }

  start(): this {
    if (isTTY) {
      process.stdout.write(A.cursorHide);
      this.timer = setInterval(() => this._render(), 1000 / 12);
    }
    return this;
  }

  setStatus(id: string, status: StepStatus, detail?: string): void {
    const s = this.steps.find(s => s.id === id);
    if (!s) return;
    s.status = status;
    if (detail) s.detail = detail;
    if (status === "done" || status === "error" || status === "warn" || status === "skip") {
      s.ms = Date.now() - this.startMs;
    }
    if (!isTTY) {
      const icon = this._icon(status);
      console.log(`  ${icon} ${s.label}${detail ? ` — ${detail}` : ""}`);
    }
  }

  finish(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (isTTY) {
      this._render();
      process.stdout.write(A.cursorShow);
    }
  }

  private _icon(s: StepStatus): string {
    const f = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];
    switch (s) {
      case "running": return xrCyan(f);
      case "done":    return xrGreen("✓");
      case "warn":    return xrAmber("!");
      case "error":   return `\x1b[38;2;255;77;77m✗\x1b[0m`;
      case "skip":    return xrDim("–");
      default:        return xrDim("·");
    }
  }

  private _render(): void {
    if (!isTTY) return;
    // Erase previously rendered lines
    if (this.rendered > 0) {
      process.stdout.write(A.moveUp(this.rendered));
    }
    this.rendered = 0;

    for (const s of this.steps) {
      const icon   = this._icon(s.status);
      const label  = s.status === "running" ? xrBold(s.label) : s.label;
      const detail = s.detail ? `  ${xrDim(s.detail)}` : "";
      const ms     = s.ms     ? `  ${xrDim(`${s.ms}ms`)}` : "";
      process.stdout.write(`${A.eraseLine}  ${icon} ${label}${detail}${ms}\n`);
      this.rendered++;
    }

    this.frame++;
  }
}

// ── Convenience ───────────────────────────────────────────────────────────────

export function spin(label: string): Spinner {
  return new Spinner().start(label);
}
