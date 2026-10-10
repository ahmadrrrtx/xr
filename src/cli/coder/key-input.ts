/**
 * Phase 23 — raw keypress dispatcher for the coding agent's TTY.
 *
 * One listener owns stdin in raw mode for the whole interactive session. It hands
 * each key to the current consumer (the line editor at the prompt, a single-key
 * approval while a turn runs). A global interceptor sees keys first, which is how
 * Ctrl+C can cancel a running turn without the prompt having to know about turns.
 *
 * Non-TTY stdin never reaches this module; callers check `available` first.
 */
import readline from "node:readline";

export interface Key {
  /** Named key ("return", "backspace", "left", "c", …) or undefined for printable text. */
  name?: string;
  /** The raw text this key produced (a single character for printable keys). */
  sequence: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

type Consumer = (key: Key) => void;
type Interceptor = (key: Key) => boolean;

export class KeyInput {
  private consumer: Consumer | null = null;
  private interceptor: Interceptor | null = null;
  private listening = false;

  constructor(private readonly stdin: NodeJS.ReadStream = process.stdin) {}

  get available(): boolean {
    return Boolean(this.stdin.isTTY);
  }

  /** Put the terminal in raw mode and start dispatching keys. Idempotent. */
  start(): void {
    if (!this.available || this.listening) return;
    readline.emitKeypressEvents(this.stdin);
    this.stdin.setRawMode(true);
    this.stdin.on("keypress", this.onKeypress);
    this.stdin.resume();
    this.listening = true;
  }

  /** Restore the terminal. Safe to call more than once. */
  stop(): void {
    if (!this.listening) return;
    this.stdin.off("keypress", this.onKeypress);
    try {
      this.stdin.setRawMode(false);
    } catch {
      /* the stream may already be gone */
    }
    this.stdin.pause();
    this.listening = false;
  }

  /** Install the receiver for keys (one at a time). Returns the previous one. */
  setConsumer(c: Consumer | null): Consumer | null {
    const prev = this.consumer;
    this.consumer = c;
    return prev;
  }

  /** Install a pre-consumer hook. Return true to swallow the key. */
  setInterceptor(i: Interceptor | null): Interceptor | null {
    const prev = this.interceptor;
    this.interceptor = i;
    return prev;
  }

  /**
   * Resolve with the first key that is in `allowed` (lower-cased single characters,
   * or named keys such as "return"). Other keys are ignored. Rejects with an
   * AbortError if `signal` fires first, so a cancelled turn never leaves a prompt open.
   */
  readKey(allowed: readonly string[], signal?: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const prev = this.consumer;
      let onAbort: (() => void) | undefined;
      const finish = (fn: () => void) => {
        this.consumer = prev;
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
        fn();
      };
      this.consumer = (key) => {
        const id = keyId(key);
        if (!allowed.includes(id)) return;
        finish(() => resolve(id));
      };
      if (signal) {
        if (signal.aborted) {
          finish(() => reject(abortError()));
          return;
        }
        onAbort = () => finish(() => reject(abortError()));
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  private readonly onKeypress = (str: string | undefined, key: readline.Key | undefined): void => {
    const k: Key = {
      name: key?.name,
      sequence: key?.sequence ?? str ?? "",
      ctrl: Boolean(key?.ctrl),
      meta: Boolean(key?.meta),
      shift: Boolean(key?.shift),
    };
    if (this.interceptor && this.interceptor(k)) return;
    this.consumer?.(k);
  };
}

/** Normalise a key to the id used by readKey: a lower-case letter or a named key. */
export function keyId(key: Key): string {
  if (key.ctrl && key.name) return `ctrl-${key.name}`;
  if (key.name && key.name.length > 1) return key.name;
  return key.sequence.toLowerCase();
}

function abortError(): Error {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}
