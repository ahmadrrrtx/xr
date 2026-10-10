/**
 * Phase 23 — streaming renderer for model output.
 *
 * Prose is written as it arrives (no line buffering: the first token shows at once).
 * Only a line that BEGINS with a backtick fence is held back until its newline,
 * because that is the only decision that needs the whole line:
 *
 *   ```ts src/auth.ts      → a labelled, tinted code block
 *   ...code lines...
 *   ```                    → closes it
 *
 * In plain mode (no colour, piped output) the raw markdown passes through
 * unchanged, so `xr -p … > out.md` stays exactly what the model wrote.
 */
import type { Painter } from "./ansi.ts";

export class MarkdownStream {
  private atLineStart = true;
  private pending: string | null = null; // a line-start that may be a fence
  private inFence = false;
  private fenceLine = ""; // the opening info string, for the header
  private codeLine = ""; // current code line being buffered

  constructor(
    private readonly write: (s: string) => void,
    private readonly painter: Painter,
    private readonly styled: boolean,
  ) {}

  /** Feed a streamed chunk. */
  push(chunk: string): void {
    for (const ch of chunk) this.feed(ch);
  }

  /** End of the message: release anything still held. */
  end(): void {
    if (this.pending !== null) {
      const held = this.pending;
      this.pending = null;
      if (this.inFence) this.codeLine += held;
      else this.prose(held);
    }
    if (this.inFence) {
      if (this.codeLine.length) this.emitCode(this.codeLine);
      this.closeFence(false);
    }
    this.atLineStart = true;
  }

  private feed(ch: string): void {
    if (this.inFence) return this.feedFence(ch);

    if (this.pending !== null) {
      this.pending += ch;
      if (ch === "\n") {
        const line = this.pending.slice(0, -1);
        this.pending = null;
        if (line.startsWith("```")) {
          this.openFence(line.slice(3).trim());
        } else {
          this.prose(`${line}\n`);
        }
        this.atLineStart = true;
        return;
      }
      // Still a possible fence line only while it is a prefix of "```…".
      if (!"```".startsWith(this.pending.slice(0, 3)) && !this.pending.startsWith("```")) {
        const held = this.pending;
        this.pending = null;
        this.prose(held);
        this.atLineStart = false;
      }
      return;
    }

    if (this.atLineStart && ch === "`") {
      this.pending = ch;
      this.atLineStart = false;
      return;
    }
    this.prose(ch);
    this.atLineStart = ch === "\n";
  }

  private feedFence(ch: string): void {
    if (ch !== "\n") {
      this.codeLine += ch;
      return;
    }
    const line = this.codeLine;
    this.codeLine = "";
    if (line.trim() === "```") {
      this.closeFence(true);
      this.atLineStart = true;
      return;
    }
    this.emitCode(line);
  }

  private prose(s: string): void {
    this.write(s);
  }

  private openFence(info: string): void {
    this.inFence = true;
    this.fenceLine = info;
    if (this.styled) {
      const label = info ? info : "code";
      this.write(this.painter.dim(`  ┌ ${label}`) + "\n");
    } else {
      this.write("```" + info + "\n");
    }
  }

  private emitCode(line: string): void {
    if (this.styled) this.write(this.painter.tint(`  ${line}`) + "\n");
    else this.write(line + "\n");
  }

  private closeFence(emitRaw: boolean): void {
    this.inFence = false;
    if (this.styled) this.write(this.painter.dim("  └") + "\n");
    else if (emitRaw) this.write("```\n");
    this.fenceLine = "";
  }
}
