/**
 * Phase 23 — output sink. One place decides how the coding agent talks:
 *   - tty    : colour, status lines, spinner (interactive terminal)
 *   - plain  : no colour, no spinner, no status chrome (pipes, NO_COLOR, --no-color)
 *   - json   : JSON Lines events only (--json), nothing human on stdout
 *
 * Human output goes to stdout (answers and status) and stderr (errors). Nothing
 * else in the coder writes to the console directly, so `--json` stays parseable.
 */
import { makePainter, type Painter } from "./ansi.ts";

export type SinkMode = "tty" | "plain" | "json";

export class Sink {
  readonly mode: SinkMode;
  readonly p: Painter;

  constructor(mode: SinkMode, colorEnabled: boolean) {
    this.mode = mode;
    this.p = makePainter(mode === "tty" && colorEnabled);
  }

  get interactive(): boolean {
    return this.mode === "tty";
  }

  get json(): boolean {
    return this.mode === "json";
  }

  /** Raw text to stdout (no newline added). Suppressed in json mode. */
  out(s: string): void {
    if (this.json) return;
    process.stdout.write(s);
  }

  /** A line on stdout. Suppressed in json mode. */
  line(s = ""): void {
    this.out(`${s}\n`);
  }

  /** A status line with a text marker: "✓ …", "✗ …", "! …", "› …", "▶ …", "✏ …". */
  status(marker: string, text: string, paint?: (s: string) => string): void {
    if (this.json) return;
    const m = this.mode === "tty" ? marker : marker.replace(/[^\x00-\x7f]/g, "") || marker;
    const styled = paint ? paint(text) : text;
    this.line(`  ${this.mode === "tty" ? this.p.cyan(m) : m} ${styled}`);
  }

  /** Error line to stderr (always, even in json mode). */
  error(text: string): void {
    process.stderr.write(`${this.mode === "tty" ? this.p.red("✗") : "error:"} ${text}\n`);
  }

  /** Warning line to stderr. */
  warn(text: string): void {
    process.stderr.write(`${this.mode === "tty" ? this.p.yellow("!") : "warning:"} ${text}\n`);
  }

  /** One JSON Lines event on stdout. Only in json mode. */
  event(obj: Record<string, unknown>): void {
    if (!this.json) return;
    process.stdout.write(`${JSON.stringify(obj)}\n`);
  }

  /** Terminal width, with a sane default when not a TTY. */
  get width(): number {
    const w = process.stdout.columns;
    return typeof w === "number" && w > 20 ? w : 100;
  }
}

/** Braille spinner, 80ms frames. Only draws in a TTY. */
export class Spinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private label = "";
  private static readonly FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  constructor(private readonly sink: Sink) {}

  get running(): boolean {
    return this.timer !== null;
  }

  start(label: string): void {
    if (!this.sink.interactive || this.timer) {
      this.label = label;
      return;
    }
    this.label = label;
    this.draw();
    this.timer = setInterval(() => this.draw(), 80);
    this.timer.unref?.();
  }

  /** Change the label while spinning. */
  update(label: string): void {
    this.label = label;
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    process.stdout.write("\r\x1b[2K");
  }

  private draw(): void {
    const f = Spinner.FRAMES[this.frame++ % Spinner.FRAMES.length]!;
    process.stdout.write(`\r\x1b[2K  ${this.sink.p.cyan(f)} ${this.sink.p.dim(this.label)}`);
  }
}
