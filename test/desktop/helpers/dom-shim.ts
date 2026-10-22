/**
 * XR-LAUNCH-026 — the smallest browser surface the desktop STORES touch, so
 * they can run under `bun test` without adding a DOM dependency (jsdom /
 * happy-dom are not in the lockfile). Rendering is covered by the Tauri window
 * smoke in the desktop journey (tauri-driver); these tests cover store logic.
 *
 * Import this FIRST (before any desktop module) — it installs:
 *   window (= globalThis), window.localStorage (in-memory), window.setTimeout,
 *   document.documentElement { dataset, style.setProperty }.
 */
class MemoryStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
}

const g = globalThis as Record<string, unknown>;
if (typeof g.window === "undefined") g.window = globalThis;
if (typeof g.localStorage === "undefined") g.localStorage = new MemoryStorage();
if (typeof g.document === "undefined") {
  const props = new Map<string, string>();
  g.document = {
    documentElement: {
      dataset: {} as Record<string, string>,
      style: { setProperty: (k: string, v: string) => props.set(k, v), getPropertyValue: (k: string) => props.get(k) ?? "" },
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      setAttribute() {},
    },
    // sonner (toasts) injects its stylesheet at import time.
    head: { appendChild() {}, firstChild: null, insertBefore() {} },
    createElement: () => ({ appendChild() {}, setAttribute() {}, styleSheet: undefined }),
    createTextNode: (t: string) => ({ data: t }),
    getElementsByTagName: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
}

/** Pretend to be (or stop being) inside a Tauri webview. */
export function setTauri(on: boolean): void {
  if (on) g.__TAURI_INTERNALS__ = {};
  else delete g.__TAURI_INTERNALS__;
}

export const storage = g.localStorage as MemoryStorage;
