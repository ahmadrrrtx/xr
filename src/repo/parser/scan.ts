/**
 * Shared character scanner used by first-party structural parsers.
 * Tracks line numbers, skips strings and comments, exposes identifier/keyword
 * reads. This is not an AST — callers label their output `structural`.
 */

export class Scan {
  readonly src: string;
  readonly n: number;
  i = 0;
  line = 1;

  constructor(src: string) {
    this.src = src;
    this.n = src.length;
  }

  peek(off = 0): string {
    return this.src[this.i + off] ?? "";
  }

  startsWith(s: string): boolean {
    return this.src.startsWith(s, this.i);
  }

  eof(): boolean {
    return this.i >= this.n;
  }

  advance(): string {
    const c = this.src[this.i++] ?? "";
    if (c === "\n") this.line += 1;
    return c;
  }

  skipWs(): void {
    while (!this.eof()) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\r" || c === "\n") this.advance();
      else break;
    }
  }

  /** Skip JS/TS/Go/Rust line + block comments. */
  skipJsComments(): boolean {
    if (this.startsWith("//")) {
      while (!this.eof() && this.peek() !== "\n") this.advance();
      return true;
    }
    if (this.startsWith("/*")) {
      this.i += 2;
      while (!this.eof() && !this.startsWith("*/")) this.advance();
      if (this.startsWith("*/")) this.i += 2;
      return true;
    }
    return false;
  }

  skipPythonComment(): boolean {
    if (this.peek() === "#") {
      while (!this.eof() && this.peek() !== "\n") this.advance();
      return true;
    }
    return false;
  }

  skipString(): boolean {
    const q = this.peek();
    if (q !== "'" && q !== "\"" && q !== "`") return false;
    this.advance();
    if (q === "`") {
      while (!this.eof()) {
        const c = this.advance();
        if (c === "\\") {
          if (!this.eof()) this.advance();
          continue;
        }
        if (c === "`") break;
      }
      return true;
    }
    while (!this.eof()) {
      const c = this.advance();
      if (c === "\\") {
        if (!this.eof()) this.advance();
        continue;
      }
      if (c === q || c === "\n") break;
    }
    return true;
  }

  /** Triple-quoted Python strings. */
  skipPythonString(): boolean {
    if (this.startsWith("'''") || this.startsWith("\"\"\"")) {
      const q = this.src.slice(this.i, this.i + 3);
      this.i += 3;
      while (!this.eof() && !this.startsWith(q)) this.advance();
      if (this.startsWith(q)) this.i += 3;
      return true;
    }
    return this.skipString();
  }

  readIdent(): string | null {
    const c = this.peek();
    if (!isIdentStart(c)) return null;
    let s = "";
    while (!this.eof() && isIdentPart(this.peek())) s += this.advance();
    return s;
  }

  expectIdent(): string {
    return this.readIdent() ?? "";
  }

  skipUntil(ch: string): void {
    while (!this.eof() && this.peek() !== ch) {
      if (this.skipString() || this.skipJsComments()) continue;
      this.advance();
    }
  }

  /**
   * Consume a balanced `{...}` or `(...)` block starting at the current
   * character. Returns the end line (inclusive of the closing delimiter).
   */
  skipBalanced(open: string, close: string): number {
    if (this.peek() !== open) return this.line;
    let depth = 0;
    while (!this.eof()) {
      if (this.skipString() || this.skipJsComments()) continue;
      const c = this.advance();
      if (c === open) depth += 1;
      else if (c === close) {
        depth -= 1;
        if (depth === 0) return this.line;
      }
    }
    return this.line;
  }
}

function isIdentStart(c: string): boolean {
  return /[A-Za-z_$]/.test(c);
}

function isIdentPart(c: string): boolean {
  return /[A-Za-z0-9_$]/.test(c);
}

export function lineAt(src: string, index: number): number {
  let line = 1;
  const n = Math.min(index, src.length);
  for (let i = 0; i < n; i++) if (src.charCodeAt(i) === 10) line += 1;
  return line;
}
