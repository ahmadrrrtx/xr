/**
 * XR 3.1 — Terminal engine
 *
 * Alternate-screen management, raw input, resize, mouse (optional),
 * damage-region rendering, and clean restore on exit.
 *
 * Spec: Performance Standards (damage regions, <16ms keypress),
 * Accessibility (NO_COLOR, reduced motion, tmux/SSH safe).
 */

import { A, getColorMode, isReducedMotion } from "./theme.ts";
import { stripAnsi, visibleLength, padAnsi, clipAnsi } from "./ansi.ts";

export type RegionId =
  | "header"
  | "sidebar"
  | "main"
  | "inspector"
  | "composer"
  | "status"
  | "overlay"
  | "full";

export interface FrameBuffer {
  cols: number;
  rows: number;
  lines: string[];
}

export interface TerminalOptions {
  mouse?: boolean;
  bracketedPaste?: boolean;
  altScreen?: boolean;
}

export type InputHandler = (data: Buffer) => void | Promise<void>;
export type ResizeHandler = (cols: number, rows: number) => void;

export class Terminal {
  private entered = false;
  private mouseEnabled = false;
  private pasteEnabled = false;
  private lastFrame: FrameBuffer | null = null;
  private writing = false;
  private inputHandler: InputHandler | null = null;
  private resizeHandler: ResizeHandler | null = null;
  private onData: ((chunk: Buffer | string) => void) | null = null;
  private onResize: (() => void) | null = null;
  private perfLog: Array<{ t: number; bytes: number; full: boolean }> = [];
  private perfEnabled = process.env.XR_PERF === "1";

  get cols(): number {
    return Math.max(1, process.stdout.columns || 80);
  }

  get rows(): number {
    return Math.max(1, process.stdout.rows || 24);
  }

  get isTTY(): boolean {
    return !!(process.stdout.isTTY && process.stdin.isTTY);
  }

  enter(opts: TerminalOptions = {}): void {
    if (!this.isTTY || this.entered) return;
    const alt = opts.altScreen !== false;
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode?.(true);

    let seq = A.cursorHide;
    if (alt) seq += A.altScreenEnter;
    if (opts.bracketedPaste !== false) {
      seq += A.bracketedPasteOn;
      this.pasteEnabled = true;
    }
    if (opts.mouse) {
      seq += A.mouseOn;
      this.mouseEnabled = true;
    }
    process.stdout.write(seq);
    this.entered = true;

    this.onData = (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
      void this.inputHandler?.(buf);
    };
    this.onResize = () => {
      this.lastFrame = null; // force full redraw on resize
      this.resizeHandler?.(this.cols, this.rows);
    };
    process.stdin.on("data", this.onData);
    process.stdout.on("resize", this.onResize);

    // Ensure restore on unexpected exit
    process.once("exit", () => this.leave());
    process.once("SIGINT", () => { this.leave(); process.exit(130); });
    process.once("SIGTERM", () => { this.leave(); process.exit(143); });
  }

  leave(): void {
    if (!this.entered) return;
    let seq = "";
    if (this.mouseEnabled) seq += A.mouseOff;
    if (this.pasteEnabled) seq += A.bracketedPasteOff;
    seq += A.altScreenLeave + A.cursorShow + A.reset;
    try {
      process.stdout.write(seq);
    } catch { /* ignore */ }
    try {
      process.stdin.setRawMode?.(false);
    } catch { /* ignore */ }
    if (this.onData) process.stdin.off("data", this.onData);
    if (this.onResize) process.stdout.off("resize", this.onResize);
    this.entered = false;
    this.lastFrame = null;

    if (this.perfEnabled && this.perfLog.length) {
      try {
        const lines = this.perfLog.map((e) => `${e.t}\t${e.bytes}\t${e.full ? "full" : "diff"}`).join("\n");
        // best-effort; Bun.write may not exist in all contexts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const BunAny = (globalThis as any).Bun;
        if (BunAny?.write) {
          // Cross-platform temp path (Windows: %TEMP%, Unix: /tmp)
          const dir = process.env.TEMP || process.env.TMPDIR || process.env.TMP || "/tmp";
          void BunAny.write(`${dir.replace(/[\\/]$/, "")}/xr-perf.log`, lines + "\n");
        }
      } catch { /* ignore */ }
    }
  }

  onInput(handler: InputHandler): void {
    this.inputHandler = handler;
  }

  onResizeEvent(handler: ResizeHandler): void {
    this.resizeHandler = handler;
  }

  /**
   * Write a full frame. Uses line-diff damage tracking:
   * only rewrite lines that changed vs lastFrame.
   * Falls back to full clear when size changes or first paint.
   */
  paint(lines: string[]): void {
    if (this.writing) return;
    this.writing = true;
    try {
      const cols = this.cols;
      const rows = this.rows;
      // Normalize to exact rows × cols
      const normalized: string[] = [];
      for (let i = 0; i < rows; i++) {
        const raw = lines[i] ?? "";
        normalized.push(padAnsi(clipAnsi(raw, cols, false), cols));
      }

      const forceFull =
        !this.lastFrame ||
        this.lastFrame.cols !== cols ||
        this.lastFrame.rows !== rows ||
        getColorMode() === "none";

      let out = "";
      let bytes = 0;
      if (forceFull) {
        out = A.clearScreen;
        for (let i = 0; i < rows; i++) {
          out += A.moveTo(i + 1, 1) + normalized[i] + A.eraseToEnd;
        }
        // park cursor bottom-left-ish (composer area handled by caller)
        out += A.moveTo(rows, 1) + A.reset;
        process.stdout.write(out);
        bytes = out.length;
      } else {
        const prev = this.lastFrame!.lines;
        const dirty: number[] = [];
        for (let i = 0; i < rows; i++) {
          if (prev[i] !== normalized[i]) dirty.push(i);
        }
        // If too many lines dirty, full redraw is cheaper
        if (dirty.length > rows * 0.6) {
          out = A.clearScreen;
          for (let i = 0; i < rows; i++) {
            out += A.moveTo(i + 1, 1) + normalized[i] + A.eraseToEnd;
          }
          out += A.moveTo(rows, 1) + A.reset;
          process.stdout.write(out);
          bytes = out.length;
        } else {
          for (const i of dirty) {
            out += A.moveTo(i + 1, 1) + normalized[i]! + A.eraseToEnd;
          }
          if (out) {
            out += A.reset;
            process.stdout.write(out);
            bytes = out.length;
          }
        }
      }

      this.lastFrame = { cols, rows, lines: normalized };
      if (this.perfEnabled) {
        this.perfLog.push({ t: Date.now(), bytes, full: forceFull });
        if (this.perfLog.length > 500) this.perfLog.shift();
      }
    } finally {
      this.writing = false;
    }
  }

  /** Force next paint to be a full redraw. */
  invalidate(): void {
    this.lastFrame = null;
  }

  /** Write raw to stdout (for progressive startup frames). */
  writeRaw(s: string): void {
    process.stdout.write(s);
    this.lastFrame = null;
  }
}

// ── Key parsing ───────────────────────────────────────────────────────────────

export type KeyName =
  | "enter" | "esc" | "tab" | "backspace" | "up" | "down" | "left" | "right"
  | "home" | "end" | "pageup" | "pagedown" | "delete"
  | "ctrl+c" | "ctrl+d" | "ctrl+k" | "ctrl+l" | "ctrl+n" | "ctrl+p"
  | "ctrl+a" | "ctrl+e" | "ctrl+u" | "ctrl+w" | "ctrl+b" | "ctrl+f"
  | "ctrl+j" | "ctrl+r" | "ctrl+t" | "ctrl+o" | "ctrl+x"
  | "ctrl+shift+p" | "shift+tab" | "shift+enter"
  | "alt+p" | "alt+t" | "alt+o" | "alt+b" | "alt+f"
  | "f1" | "f2" | "f3" | "f4" | "f5"
  | "char" | "paste" | "unknown";

export interface KeyEvent {
  name: KeyName;
  char?: string;
  raw: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  paste?: string;
}

export function parseKey(data: Buffer): KeyEvent {
  const bytes = Array.from(data);
  const text = data.toString("utf8");

  // Bracketed paste
  if (text.startsWith("\x1b[200~")) {
    const end = text.indexOf("\x1b[201~");
    const body = end >= 0 ? text.slice(6, end) : text.slice(6);
    return { name: "paste", paste: body, raw: text, ctrl: false, alt: false, shift: false };
  }

  // Ctrl+letter
  if (bytes.length === 1) {
    const b = bytes[0]!;
    if (b === 3)  return { name: "ctrl+c", raw: text, ctrl: true, alt: false, shift: false };
    if (b === 4)  return { name: "ctrl+d", raw: text, ctrl: true, alt: false, shift: false };
    if (b === 1)  return { name: "ctrl+a", raw: text, ctrl: true, alt: false, shift: false };
    if (b === 5)  return { name: "ctrl+e", raw: text, ctrl: true, alt: false, shift: false };
    if (b === 11) return { name: "ctrl+k", raw: text, ctrl: true, alt: false, shift: false };
    if (b === 12) return { name: "ctrl+l", raw: text, ctrl: true, alt: false, shift: false };
    if (b === 14) return { name: "ctrl+n", raw: text, ctrl: true, alt: false, shift: false };
    if (b === 16) return { name: "ctrl+p", raw: text, ctrl: true, alt: false, shift: false };
    if (b === 21) return { name: "ctrl+u", raw: text, ctrl: true, alt: false, shift: false };
    if (b === 23) return { name: "ctrl+w", raw: text, ctrl: true, alt: false, shift: false };
    if (b === 2)  return { name: "ctrl+b", raw: text, ctrl: true, alt: false, shift: false };
    if (b === 6)  return { name: "ctrl+f", raw: text, ctrl: true, alt: false, shift: false };
    if (b === 10) return { name: "ctrl+j", raw: text, ctrl: true, alt: false, shift: false };
    if (b === 18) return { name: "ctrl+r", raw: text, ctrl: true, alt: false, shift: false };
    if (b === 20) return { name: "ctrl+t", raw: text, ctrl: true, alt: false, shift: false };
    if (b === 15) return { name: "ctrl+o", raw: text, ctrl: true, alt: false, shift: false };
    if (b === 24) return { name: "ctrl+x", raw: text, ctrl: true, alt: false, shift: false };
    if (b === 9)  return { name: "tab", raw: text, ctrl: false, alt: false, shift: false };
    if (b === 13) return { name: "enter", raw: text, ctrl: false, alt: false, shift: false };
    if (b === 127 || b === 8) return { name: "backspace", raw: text, ctrl: false, alt: false, shift: false };
    if (b === 27) return { name: "esc", raw: text, ctrl: false, alt: false, shift: false };
  }

  // Escape sequences
  if (text === "\x1b[A" || text === "\x1bOA") return { name: "up", raw: text, ctrl: false, alt: false, shift: false };
  if (text === "\x1b[B" || text === "\x1bOB") return { name: "down", raw: text, ctrl: false, alt: false, shift: false };
  if (text === "\x1b[C" || text === "\x1bOC") return { name: "right", raw: text, ctrl: false, alt: false, shift: false };
  if (text === "\x1b[D" || text === "\x1bOD") return { name: "left", raw: text, ctrl: false, alt: false, shift: false };
  if (text === "\x1b[H" || text === "\x1b[1~") return { name: "home", raw: text, ctrl: false, alt: false, shift: false };
  if (text === "\x1b[F" || text === "\x1b[4~") return { name: "end", raw: text, ctrl: false, alt: false, shift: false };
  if (text === "\x1b[5~") return { name: "pageup", raw: text, ctrl: false, alt: false, shift: false };
  if (text === "\x1b[6~") return { name: "pagedown", raw: text, ctrl: false, alt: false, shift: false };
  if (text === "\x1b[3~") return { name: "delete", raw: text, ctrl: false, alt: false, shift: false };
  if (text === "\x1b[Z") return { name: "shift+tab", raw: text, ctrl: false, alt: false, shift: true };

  // Alt+letter (ESC then char)
  if (bytes.length === 2 && bytes[0] === 27) {
    const c = String.fromCharCode(bytes[1]!);
    if (c === "p") return { name: "alt+p", raw: text, ctrl: false, alt: true, shift: false };
    if (c === "t") return { name: "alt+t", raw: text, ctrl: false, alt: true, shift: false };
    if (c === "o") return { name: "alt+o", raw: text, ctrl: false, alt: true, shift: false };
    if (c === "b") return { name: "alt+b", raw: text, ctrl: false, alt: true, shift: false };
    if (c === "f") return { name: "alt+f", raw: text, ctrl: false, alt: true, shift: false };
  }

  // Printable
  if (text.length >= 1 && text >= " " && !text.startsWith("\x1b")) {
    return { name: "char", char: text, raw: text, ctrl: false, alt: false, shift: false };
  }

  return { name: "unknown", raw: text, ctrl: false, alt: false, shift: false };
}

export { stripAnsi, visibleLength, padAnsi, clipAnsi, isReducedMotion };
