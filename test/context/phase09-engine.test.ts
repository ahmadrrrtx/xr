/**
 * Phase 09 — Memory Engine enablement, lifecycle, and doctor honesty.
 *
 * Doctor must never report "enabled" when the store is unavailable, and must
 * never report "disabled" when the engine is actually serving.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { IsolatedMemoryStore } from "../../src/context/isolated-store.ts";
import {
  inspectMemoryEngine,
  engineLabel,
  recordRetrievalLatency,
} from "../../src/context/engine.ts";
import { isMemoryEnabled } from "../../src/config/config.ts";

let tmp: string;
const prevDisabled = process.env.XR_MEMORY_DISABLED;
const prevHome = process.env.XR_HOME;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-p09-eng-"));
  process.env.XR_HOME = join(tmp, "home");
  delete process.env.XR_MEMORY_DISABLED;
});

afterEach(() => {
  if (prevDisabled === undefined) delete process.env.XR_MEMORY_DISABLED;
  else process.env.XR_MEMORY_DISABLED = prevDisabled;
  if (prevHome === undefined) delete process.env.XR_HOME;
  else process.env.XR_HOME = prevHome;
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

function fresh(ws = "default") {
  const store = new Store(ws, join(tmp, `${ws}.db`));
  return { store, mem: new IsolatedMemoryStore(store) };
}

describe("9.1 memory enablement", () => {
  test("default config enables memory and the store is actually usable", () => {
    expect(isMemoryEnabled()).toBe(true);
    const { store, mem } = fresh();
    const added = mem.add({ content: "I prefer TypeScript", category: "preference" });
    expect(added.ok).toBe(true);
    expect(mem.list().length).toBe(1);
    const report = inspectMemoryEngine(store);
    expect(report.configuredEnabled).toBe(true);
    expect(report.enabled).toBe(true);
    expect(report.state).not.toBe("disabled");
    expect(report.store).toBe("healthy");
    expect(report.memoryCount).toBeGreaterThanOrEqual(1);
    store.close();
  });

  test("XR_MEMORY_DISABLED=1 reports disabled and does not claim the store is serving", () => {
    process.env.XR_MEMORY_DISABLED = "1";
    expect(isMemoryEnabled()).toBe(false);
    const { store } = fresh();
    const report = inspectMemoryEngine(store);
    expect(report.enabled).toBe(false);
    expect(report.state).toBe("disabled");
    expect(engineLabel(report).mark).toBe("fail");
    expect(engineLabel(report).text).toContain("disabled");
    store.close();
  });

  test("missing store is never reported as enabled", () => {
    const report = inspectMemoryEngine(undefined);
    expect(report.configuredEnabled).toBe(true);
    expect(report.enabled).toBe(false);
    expect(["init", "recovering"]).toContain(report.state);
    expect(report.detail.toLowerCase()).toContain("unavailable");
  });

  test("doctor label reflects runtime state, not a stale boolean", () => {
    const { store, mem } = fresh();
    mem.add({ content: "project uses bun", category: "fact" });
    recordRetrievalLatency(12);
    const on = inspectMemoryEngine(store);
    expect(on.enabled).toBe(true);
    expect(engineLabel(on).mark).toBe("ok");

    process.env.XR_MEMORY_DISABLED = "1";
    const off = inspectMemoryEngine(store);
    expect(off.enabled).toBe(false);
    expect(engineLabel(off).text).toBe("disabled");
    store.close();
  });
});

describe("9.2 memory lifecycle", () => {
  test("healthy store reports ready or active, never silently disabled", () => {
    const { store } = fresh();
    const report = inspectMemoryEngine(store);
    expect(["ready", "active", "compacting"]).toContain(report.state);
    expect(report.store).toBe("healthy");
    expect(report.retrieval).toBe("healthy");
    store.close();
  });

  test("retrieval latency observation moves READY → ACTIVE", () => {
    const { store } = fresh();
    recordRetrievalLatency(4.2);
    const report = inspectMemoryEngine(store);
    expect(report.state).toBe("active");
    expect(report.lastRetrievalLatencyMs).toBe(4.2);
    store.close();
  });
});

describe("9.19 doctor / status fields", () => {
  test("report exposes store, retrieval, index, isolation, integrity, counts", () => {
    const { store, mem } = fresh();
    mem.add({ content: "note", category: "fact" });
    const r = inspectMemoryEngine(store);
    expect(r.store).toBeDefined();
    expect(r.retrieval).toBeDefined();
    expect(r.index).toBeDefined();
    expect(r.isolation).toBeDefined();
    expect(r.integrity).toBeDefined();
    expect(typeof r.memoryCount).toBe("number");
    expect(typeof r.indexCount).toBe("number");
    expect(JSON.stringify(r)).not.toMatch(/sk-|Bearer |password/i);
    store.close();
  });
});
