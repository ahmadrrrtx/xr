/**
 * Phase 23 — single-line editor for the coding agent's prompt (raw TTY only).
 *
 * Keys: printable text · Enter · Backspace/Delete · ←/→ · Home/End (Ctrl+A/E) ·
 * ↑/↓ history · Ctrl+U/K/W (kill) · Tab (two spaces) · Ctrl+L (clear screen) ·
 * Ctrl+C (clear the line; twice on an empty line to exit) · Ctrl+D (exit on an empty line).
 *
 * Resolves with the submitted line, or `null` when the user asked to exit.
 */
import { stripAnsi } from "./ansi.ts";
import type { Key, KeyInput } from "./key-input.ts";

const DOUBLE_CTRL_C_MS = 2_000;

export class LineEditor {
  private buf = "";
  private cursor = 0;
  /** -1 = editing a fresh line; otherwise an index into history (0 = oldest). */
  private histIdx = -1;
  private saved = "";
  private lastCtrlC = 0;
  private prompt = "";
  private promptWidth = 0;
  private history: string[] = [];

  constructor(
    private readonly keys: KeyInput,
    private readonly write: (s: string) => void,
  ) {}

  /** Read one line. `prompt` may contain ANSI styling; its visible width is measured. */
  read(prompt: string, history: string[]): Promise<string | null> {
    this.prompt = prompt;
    this.promptWidth = stripAnsi(prompt).length;
    this.history = history;
    this.buf = "";
    this.cursor = 0;
    this.histIdx = -1;
    this.saved = "";
    this.redraw();

    return new Promise<string | null>((resolve) => {
      const prev = this.keys.setConsumer((key) => {
        const done = (value: string | null) => {
          this.keys.setConsumer(prev);
          this.write("\n");
          resolve(value);
        };
        const action = this.apply(key);
        if (action === "submit") done(this.buf);
        else if (action === "exit") done(null);
      });
    });
  }

  /** Apply one key. Returns "submit" / "exit" to finish, otherwise undefined. */
  apply(key: Key): "submit" | "exit" | undefined {
    const name = key.name;
    if (key.ctrl) {
      switch (name) {
        case "c": {
          if (this.buf.length) {
            this.buf = "";
            this.cursor = 0;
            this.redraw();
            return undefined;
          }
          const now = Date.now();
          if (now - this.lastCtrlC < DOUBLE_CTRL_C_MS) return "exit";
          this.lastCtrlC = now;
          this.write("\n  (press Ctrl+C again to exit, or Ctrl+D)\n");
          this.redraw();
          return undefined;
        }
        case "d":
          if (this.buf.length === 0) return "exit";
          this.deleteAtCursor();
          return undefined;
        case "a":
          this.cursor = 0;
          break;
        case "e":
          this.cursor = this.buf.length;
          break;
        case "u":
          this.buf = this.buf.slice(this.cursor);
          this.cursor = 0;
          break;
        case "k":
          this.buf = this.buf.slice(0, this.cursor);
          break;
        case "w": {
          const before = this.buf.slice(0, this.cursor).replace(/\s+$/, "");
          const cut = before.replace(/\S+$/, "");
          this.buf = cut + this.buf.slice(this.cursor);
          this.cursor = cut.length;
          break;
        }
        case "l":
          this.write("\x1b[2J\x1b[H");
          break;
        default:
          return undefined;
      }
      this.redraw();
      return undefined;
    }

    switch (name) {
      case "return":
      case "enter":
        return "submit";
      case "backspace":
        if (this.cursor > 0) {
          this.buf = this.buf.slice(0, this.cursor - 1) + this.buf.slice(this.cursor);
          this.cursor--;
        }
        break;
      case "delete":
        this.deleteAtCursor();
        break;
      case "left":
        if (this.cursor > 0) this.cursor--;
        break;
      case "right":
        if (this.cursor < this.buf.length) this.cursor++;
        break;
      case "home":
        this.cursor = 0;
        break;
      case "end":
        this.cursor = this.buf.length;
        break;
      case "up":
        this.historyStep(-1);
        break;
      case "down":
        this.historyStep(1);
        break;
      case "tab":
        this.insert("  ");
        break;
      default:
        if (!key.meta && key.sequence && key.sequence.length === 1 && key.sequence >= " " && key.sequence !== "\u007f") {
          this.insert(key.sequence);
        } else if (!key.meta && key.sequence && key.sequence.length > 1 && !key.sequence.startsWith("\x1b")) {
          // Pasted text arrives as one chunk; keep printable characters only.
          this.insert(key.sequence.replace(/[\x00-\x1f\x7f]/g, ""));
        } else {
          return undefined;
        }
    }
    this.redraw();
    return undefined;
  }

  /** Current buffer (for tests and the history push). */
  get value(): string {
    return this.buf;
  }

  private insert(text: string): void {
    if (!text) return;
    this.buf = this.buf.slice(0, this.cursor) + text + this.buf.slice(this.cursor);
    this.cursor += text.length;
  }

  private deleteAtCursor(): void {
    if (this.cursor < this.buf.length) {
      this.buf = this.buf.slice(0, this.cursor) + this.buf.slice(this.cursor + 1);
    }
  }

  private historyStep(dir: -1 | 1): void {
    if (!this.history.length) return;
    if (this.histIdx === -1) {
      if (dir === 1) return;
      this.saved = this.buf;
      this.histIdx = this.history.length - 1;
    } else {
      const next = this.histIdx + dir;
      if (next < 0) return;
      if (next >= this.history.length) {
        this.histIdx = -1;
        this.buf = this.saved;
        this.cursor = this.buf.length;
        return;
      }
      this.histIdx = next;
    }
    this.buf = this.history[this.histIdx]!;
    this.cursor = this.buf.length;
  }

  private redraw(): void {
    const tail = this.buf.length - this.cursor;
    this.write(`\r\x1b[2K${this.prompt}${this.buf}`);
    if (tail > 0) this.write(`\x1b[${tail}D`);
  }

  /** Column of the cursor (for tests). */
  get column(): number {
    return this.promptWidth + this.cursor;
  }
}
