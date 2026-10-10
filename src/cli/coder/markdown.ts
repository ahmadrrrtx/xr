/**
 * Streaming markdown renderer for the coder CLI.
 *
 * Model output arrives as token deltas. Prose and code are rendered per
 * completed line so inline markup (`code`, **bold**) and fenced blocks can be
 * styled correctly; the partial last line is held until its newline or until
 * `finish()`. Fenced blocks get a background tint and a label from the info
 * string (```ts src/foo.ts). No syntax highlighting (P23 scope).
 */

import { style } from "./style.ts";

export interface MarkdownSink {
  (text: string): void;
}

export class MarkdownStream {
  private pending = "";
  private inFence = false;
  private fenceLabel = "";

  constructor(private readonly write: MarkdownSink) {}

  push(delta: string): void {
    this.pending += delta;
    let nl = this.pending.indexOf("\n");
    while (nl >= 0) {
      const line = this.pending.slice(0, nl);
      this.pending = this.pending.slice(nl + 1);
      this.renderLine(line);
      nl = this.pending.indexOf("\n");
    }
  }

  finish(): void {
    if (this.pending.length > 0) {
      this.renderLine(this.pending);
      this.pending = "";
    }
    if (this.inFence) {
      this.inFence = false;
      this.fenceLabel = "";
    }
  }

  private renderLine(line: string): void {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```")) {
      if (this.inFence) {
        this.inFence = false;
        this.fenceLabel = "";
        this.write("\n");
        return;
      }
      this.inFence = true;
      const info = trimmed.slice(3).trim();
      this.fenceLabel = info;
      if (info) this.write(style.dim(`┄ ${info}`) + "\n");
      return;
    }
    if (this.inFence) {
      this.write(style.codeBg(`  ${line}  `) + "\n");
      return;
    }
    this.write(formatProse(line) + "\n");
  }
}

/** Inline formatting for a single prose line: headings, bullets, `code`, **bold**. */
export function formatProse(line: string): string {
  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
  if (heading) return style.bold(inline(heading[2] ?? ""));
  const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
  if (bullet) return `${bullet[1] ?? ""}• ${inline(bullet[2] ?? "")}`;
  return inline(line);
}

function inline(text: string): string {
  // Split out `code` spans first so their contents are never bold-processed.
  return text
    .split(/(`[^`\n]+`)/)
    .map((part, idx) => {
      if (idx % 2 === 1) return style.cyan(part.slice(1, -1));
      return part.replace(/\*\*([^*\n]+)\*\*/g, (_m, inner: string) => style.bold(inner));
    })
    .join("");
}
