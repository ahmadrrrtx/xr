/**
 * Terminal input for the coder REPL: one raw-mode key reader, a small line
 * editor with persistent history, single-key choices, and masked secret input.
 *
 * Exactly one listener owns stdin while the REPL runs; the line editor, the
 * approval prompts and the in-turn Ctrl+C handler all go through `Terminal`
 * so keys are never consumed twice.
 */

import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { style } from "./style.ts";

export interface Key {
  /** Normalized name: "enter", "backspace", "left", "ctrl-c", "a", … */
  name: string;
  /** The printable character, when the key is a character. */
  char?: string;
}

type KeyHandler = (key: Key) => void;

const SEQUENCES: Record<string, string> = {
  "\x1b[A": "up",
  "\x1b[B": "down",
  "\x1b[C": "right",
  "\x1b[D": "left",
  "\x1bOA": "up",
  "\x1bOB": "down",
  "\x1bOC": "right",
  "\x1bOD": "left",
  "\x1b[H": "home",
  "\x1b[F": "end",
  "\x1bOH": "home",
  "\x1bOF": "end",
  "\x1b[1~": "home",
  "\x1b[4~": "end",
  "\x1b[3~": "delete",
  "\x1b[Z": "shift-tab",
};

/** Split a raw stdin chunk into keys. Unknown escape sequences are dropped. */
export function parseKeys(chunk: string): Key[] {
  const keys: Key[] = [];
  let i = 0;
  while (i < chunk.length) {
    if (chunk[i] === "\x1b") {
      const seq3 = chunk.slice(i, i + 3);
      const seq4 = chunk.slice(i, i + 4);
      if (SEQUENCES[seq3]) {
        keys.push({ name: SEQUENCES[seq3]! });
        i += 3;
        continue;
      }
      if (SEQUENCES[seq4]) {
        keys.push({ name: SEQUENCES[seq4]! });
        i += 4;
        continue;
      }
      // Alt+key or an unknown sequence: skip the escape introducer.
      i += 1;
      continue;
    }
    const ch = chunk[i]!;
    const code = ch.charCodeAt(0);
    i += 1;
    if (ch === "\r" || ch === "\n") keys.push({ name: "enter" });
    else if (ch === "\x7f" || ch === "\b") keys.push({ name: "backspace" });
    else if (ch === "\t") keys.push({ name: "tab" });
    else if (code >= 1 && code <= 26) keys.push({ name: `ctrl-${String.fromCharCode(code + 96)}` });
    else if (code >= 32) keys.push({ name: "char", char: ch });
  }
  return keys;
}

export class Terminal {
  private handlers = new Set<KeyHandler>();
  private raw = false;
  private started = false;
  private readonly onData = (chunk: Buffer | string): void => {
    for (const key of parseKeys(typeof chunk === "string" ? chunk : chunk.toString("utf8"))) {
      for (const h of [...this.handlers]) h(key);
    }
  };

  constructor(private readonly input: NodeJS.ReadStream = process.stdin) {}

  get isTTY(): boolean {
    return Boolean(this.input.isTTY);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.isTTY) {
      this.input.setRawMode(true);
      this.raw = true;
    }
    this.input.setEncoding("utf8");
    this.input.on("data", this.onData);
    this.input.resume();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.input.off("data", this.onData);
    if (this.raw) {
      this.input.setRawMode(false);
      this.raw = false;
    }
    this.input.pause();
  }

  on(handler: KeyHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

export type LineResult = { kind: "line"; text: string } | { kind: "eof" } | { kind: "interrupt" };

/**
 * Read one line with editing keys: left/right/home/end, backspace/delete,
 * up/down through history, ctrl-a/e/u/w/l, tab inserts two spaces.
 */
export function readLine(
  term: Terminal,
  prompt: string,
  history: readonly string[],
  opts: { render?: (text: string) => string } = {},
): Promise<LineResult> {
  return new Promise((resolve) => {
    let buf = "";
    let cursor = 0;
    let histIndex = history.length;
    let saved = "";
    const write = (s: string) => process.stdout.write(s);
    const paint = () => {
      const shown = opts.render ? opts.render(buf) : buf;
      write(`\r\x1b[2K${prompt}${shown}`);
      const back = buf.length - cursor;
      if (back > 0) write(`\x1b[${back}D`);
    };
    const finish = (r: LineResult) => {
      unsubscribe();
      write("\r\x1b[2K");
      resolve(r);
    };
    const unsubscribe = term.on((key) => {
      switch (key.name) {
        case "enter":
          write("\n");
          return finish({ kind: "line", text: buf });
        case "ctrl-c":
          return finish({ kind: "interrupt" });
        case "ctrl-d":
          if (buf.length === 0) return finish({ kind: "eof" });
          buf = buf.slice(0, cursor) + buf.slice(cursor + 1);
          break;
        case "backspace":
          if (cursor > 0) {
            buf = buf.slice(0, cursor - 1) + buf.slice(cursor);
            cursor--;
          }
          break;
        case "delete":
          buf = buf.slice(0, cursor) + buf.slice(cursor + 1);
          break;
        case "left":
          cursor = Math.max(0, cursor - 1);
          break;
        case "right":
          cursor = Math.min(buf.length, cursor + 1);
          break;
        case "home":
        case "ctrl-a":
          cursor = 0;
          break;
        case "end":
        case "ctrl-e":
          cursor = buf.length;
          break;
        case "ctrl-u":
          buf = buf.slice(cursor);
          cursor = 0;
          break;
        case "ctrl-w": {
          const before = buf.slice(0, cursor).replace(/\s*\S*$/, "");
          buf = before + buf.slice(cursor);
          cursor = before.length;
          break;
        }
        case "ctrl-l":
          write("\x1b[2J\x1b[H");
          break;
        case "up":
          if (histIndex > 0) {
            if (histIndex === history.length) saved = buf;
            histIndex--;
            buf = history[histIndex] ?? "";
            cursor = buf.length;
          }
          break;
        case "down":
          if (histIndex < history.length) {
            histIndex++;
            buf = histIndex === history.length ? saved : (history[histIndex] ?? "");
            cursor = buf.length;
          }
          break;
        case "tab":
          buf = buf.slice(0, cursor) + "  " + buf.slice(cursor);
          cursor += 2;
          break;
        case "char":
          buf = buf.slice(0, cursor) + (key.char ?? "") + buf.slice(cursor);
          cursor += (key.char ?? "").length;
          break;
        default:
          return;
      }
      paint();
    });
    paint();
  });
}

/**
 * Wait for one of `allowed` keys. `fallback` is used when the user presses
 * Enter. Ctrl+C resolves to "interrupt" (callers decide what that means).
 */
export function readChoice(
  term: Terminal,
  allowed: readonly string[],
  fallback?: string,
): Promise<string> {
  return new Promise((resolve) => {
    const unsubscribe = term.on((key) => {
      if (key.name === "ctrl-c") {
        unsubscribe();
        return resolve("interrupt");
      }
      if (key.name === "enter" && fallback) {
        unsubscribe();
        return resolve(fallback);
      }
      const k = (key.char ?? "").toLowerCase();
      if (k && allowed.includes(k)) {
        unsubscribe();
        return resolve(k);
      }
    });
  });
}

/** Read a secret without echo (API keys). Returns null on Ctrl+C or EOF. */
export function readSecret(term: Terminal, prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    let buf = "";
    process.stdout.write(prompt);
    const unsubscribe = term.on((key) => {
      if (key.name === "enter") {
        unsubscribe();
        process.stdout.write("\n");
        return resolve(buf);
      }
      if (key.name === "ctrl-c" || key.name === "ctrl-d") {
        unsubscribe();
        process.stdout.write("\n");
        return resolve(null);
      }
      if (key.name === "backspace") buf = buf.slice(0, -1);
      else if (key.name === "char") buf += key.char ?? "";
    });
  });
}

// ── History ───────────────────────────────────────────────────────────────

const MAX_HISTORY = 1000;
/** Lines that look like credentials are never written to history. */
const SECRET_LIKE = /(sk-[A-Za-z0-9_-]{16,}|gsk_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{12,}|xox[baprs]-[A-Za-z0-9-]{10,})/;

export function loadHistory(path: string): string[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.length > 0);
  return lines.slice(-MAX_HISTORY);
}

export function appendHistory(path: string, line: string, history: string[]): void {
  const text = line.trim();
  if (!text || SECRET_LIKE.test(text) || history[history.length - 1] === text) return;
  mkdirSync(dirname(path), { recursive: true });
  const existed = existsSync(path);
  appendFileSync(path, `${text.replace(/\n/g, " ")}\n`, { mode: 0o600 });
  if (!existed) chmodSync(path, 0o600);
  history.push(text);
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

export const dim = style.dim;
