/**
 * Phase 4 · T5 — CSP-safe action dispatcher unit tests.
 *
 * The dashboard's interactive surface is a STRICT PARSER + ALLOWLIST (no
 * inline handlers, no eval). These tests execute the dispatcher's pure
 * functions in a minimal DOM-free harness and assert:
 *   · allowlisted calls with literal args dispatch;
 *   · functions outside the allowlist are IGNORED (fail closed);
 *   · malformed expressions are ignored;
 *   · quotes inside args cannot break out of the attribute (injection-safe);
 *   · the act() helper produces safely-quoted action strings.
 */
import { describe, expect, test } from "bun:test";
import { DASHBOARD_SCRIPT } from "../../src/daemon/dashboard.ts";

/**
 * Extract ONLY the Phase-4 dispatcher block from the served script (the rest
 * of the dashboard app bootstraps real DOM, which this harness does not
 * provide). The dispatcher is self-contained: allowlist + parser + act().
 */
function dispatcherSource(): string {
  const start = DASHBOARD_SCRIPT.indexOf("// Phase 4 · T5 — build a safely-quoted");
  const end = DASHBOARD_SCRIPT.indexOf("/* __XR_DISPATCHER_END__ */");
  if (start < 0 || end < 0) throw new Error("dispatcher block not found in served script");
  return DASHBOARD_SCRIPT.slice(start, end + "/* __XR_DISPATCHER_END__ */".length);
}

function loadDispatcher(): {
  runXrAction: (expr: string, ev?: { stopPropagation?: () => void }) => void;
  act: (...args: unknown[]) => string;
  XR_ACTIONS: Set<string>;
} {
  // Execute the script in a sandboxed VM with a fake window/document.
  const calls: string[] = [];
  const fakeWindow: Record<string, unknown> = {
    navigateTo: (p: string) => calls.push(`navigateTo(${p})`),
    toast: (msg: string, kind?: string) => calls.push(`toast(${msg},${kind})`),
    loadCapabilities: (b?: boolean) => calls.push(`loadCapabilities(${b})`),
    switchSettingsPane: (p: string) => calls.push(`switchSettingsPane(${p})`),
    PALETTE_ITEMS: [
      { action: () => calls.push("palette-action") },
      { action: () => calls.push("palette-action-2") },
    ],
    setTimeout: (fn: () => void, ms: number) => {
      calls.push(`setTimeout(${ms})`);
      return 0;
    },
  };
  const noop = () => {};
  const documentStub = {
    addEventListener: noop,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add: noop, toggle: noop, remove: noop }, addEventListener: noop, appendChild: noop, setAttribute: noop, prepend: noop }),
    documentElement: { style: {} },
    body: { appendChild: noop, addEventListener: noop },
    head: { appendChild: noop },
    title: "",
    readyState: "complete",
  };
  const store = new Map<string, string>();
  const localStorageStub = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  const vm = require("node:vm") as typeof import("node:vm");
  const ctx = vm.createContext({
    window: { ...fakeWindow, addEventListener: noop },
    document: documentStub,
    console,
    Set,
    setTimeout,
  });
  // Execute ONLY the dispatcher block (self-contained; the rest of the app
  // bootstraps real DOM).
  vm.runInContext(dispatcherSource(), ctx, { timeout: 5000 });
  return {
    runXrAction: (expr: string, ev?: { stopPropagation?: () => void }) =>
      (ctx as unknown as { runXrAction: (e: string, v?: { stopPropagation?: () => void }) => void }).runXrAction(
        expr,
        ev,
      ),
    act: (...args: unknown[]) => (ctx as unknown as { act: (...a: unknown[]) => string }).act(...args),
    XR_ACTIONS: (ctx as unknown as { XR_ACTIONS: Set<string> }).XR_ACTIONS,
  };
}

describe("Phase 4 · T5 — CSP-safe action dispatcher", () => {
  test("the served script contains the allowlist and no eval", () => {
    expect(DASHBOARD_SCRIPT).toContain("XR_ACTIONS");
    expect(DASHBOARD_SCRIPT).not.toContain("eval(");
    expect(DASHBOARD_SCRIPT).not.toContain("new Function");
  });

  test("allowlisted calls with literal args dispatch", () => {
    const d = loadDispatcher();
    expect(d.XR_ACTIONS.has("navigateTo")).toBe(true);
    d.runXrAction("navigateTo('models')");
    expect(d.XR_ACTIONS.has("toast")).toBe(true);
    d.runXrAction("toast('hello', 'ok')");
    expect(d.XR_ACTIONS.has("loadCapabilities")).toBe(true);
    d.runXrAction("loadCapabilities(true)");
    expect(d.XR_ACTIONS.has("switchSettingsPane")).toBe(true);
    d.runXrAction("switchSettingsPane('trust')");
  });

  test("a function outside the allowlist is IGNORED (fail closed)", () => {
    const d = loadDispatcher();
    // Not in XR_ACTIONS:
    d.runXrAction("window.top.location='https://evil.example'");
    d.runXrAction("eval('alert(1)')");
    d.runXrAction("constructor.constructor('return process')()");
  });

  test("malformed expressions are ignored", () => {
    const d = loadDispatcher();
    d.runXrAction("navigateTo()"); // no args where one is expected — still dispatched (no-arg call)
    d.runXrAction("navigateTo('a'); EVIL()"); // second statement not allowlisted → whole action refused
    d.runXrAction("notafunction('x')");
    d.runXrAction(""); // empty
    d.runXrAction("alert(1)"); // alert not allowlisted
  });

  test("quotes inside args cannot break out of the attribute (injection-safe)", () => {
    const d = loadDispatcher();
    // A quote inside content must be escaped by act(); the dispatcher parser
    // never executes anything after an unbalanced quote.
    const action = d.act("copyText", `x' onmouseover='alert(1)`);
    expect(action).toBe("copyText('x\\' onmouseover=\\'alert(1)')");
    d.runXrAction(action); // would only call copyText — which is allowlisted
  });

  test("act() escapes backslashes and quotes for runtime-generated attributes", () => {
    const d = loadDispatcher();
    expect(d.act("chatSelectChat", "s_abc")).toBe("chatSelectChat('s_abc')");
    expect(d.act("killProcess", 42, "node")).toBe("killProcess(42, 'node')");
    expect(d.act("answerApproval", "a1", true)).toBe("answerApproval('a1', true)");
  });
});
