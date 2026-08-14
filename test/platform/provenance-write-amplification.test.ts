/**
 * XR — regression guard for the Windows cross-platform CI blocker.
 *
 * ROOT CAUSE (job 94749100848, "Windows — full parity"):
 * `CapabilityService.list()` indexed every descriptor into the provenance
 * graph through a FRESH `CapabilityProvenanceStore` per row
 * (`this.provenance()` returns `new CapabilityProvenanceStore()`). Each fresh
 * store starts with `hasFlushed = false`, so its very first mutation always
 * flushed synchronously and the write-behind throttle (256 events / 1 s) could
 * never engage. One flush is a FULL rewrite of the graph:
 * `JSON.stringify(state)` → temp file → `renameSync`.
 *
 * With ~153 descriptors that is ~153 whole-file rewrites per `list()`, and
 * `list()` backs `inspect()`, `discover()` and `provenanceOf()`. The
 * capability lifecycle test called those repeatedly, producing ~1,703 atomic
 * rewrites and ~125 MB of write traffic for ONE test.
 *
 * On Linux/macOS (tmpfs, cheap rename) that cost ~1.8 s and passed. On the
 * Windows runner every write+rename pays NTFS metadata cost plus Defender
 * real-time scanning; at a realistic ~5 ms per rewrite the same test needs
 * >8 s and blows Bun's 5 s default per-test timeout. That is precisely the
 * observed CI signature: a `(fail)` line with NO assertion diff and no
 * `error:` line, because a timeout is the only Bun failure mode that prints
 * neither.
 *
 * These tests fail if the per-descriptor flush behaviour returns. They assert
 * the WORK DONE (number of full-graph rewrites), not wall-clock time, so they
 * are deterministic and not machine-speed dependent.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CapabilityProvenanceStore } from "../../src/platform/capabilities/provenance.ts";
import { CapabilityService } from "../../src/platform/capabilities/service.ts";
import { Store } from "../../src/state/workspace-store.ts";
import type { CapabilityDescriptor } from "../../src/platform/capabilities/types.ts";

let root: string;
let previousHome: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "xr-prov-amp-"));
  previousHome = process.env.XR_HOME;
  process.env.XR_HOME = join(root, "home");
  mkdirSync(process.env.XR_HOME, { recursive: true });
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.XR_HOME;
  else process.env.XR_HOME = previousHome;
  rmSync(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
});

function descriptor(index: number): CapabilityDescriptor {
  return {
    id: `tool:amp-${index}`,
    type: "tool",
    nativeId: `amp-${index}`,
    name: `Amp ${index}`,
    version: "1.0.0",
    description: `write-amplification probe ${index}`,
    publisher: { id: "xr", name: "XR", verified: true },
    placement: { requested: "in-process", riskTier: "low" },
    dataScopes: [],
    dependencies: [],
    permissions: [],
    lifecycle: { installed: true, enabled: true, state: "enabled" },
    certification: { status: "unknown" },
    trust: { level: "builtin" },
  } as unknown as CapabilityDescriptor;
}

/**
 * Count full-graph rewrites (write + rename) performed by `run`.
 *
 * The hook is installed on the PROTOTYPE, not on one instance, because the
 * defect being guarded is precisely that the service allocated a NEW
 * `CapabilityProvenanceStore` per descriptor. An instance-level hook would
 * miss every one of those stores and the guard would pass while the bug is
 * present (verified).
 */
function countFlushes(run: () => void): number {
  let flushes = 0;
  const proto = CapabilityProvenanceStore.prototype as unknown as { flush: () => void };
  const original = proto.flush;
  proto.flush = function patched(this: CapabilityProvenanceStore) {
    flushes += 1;
    return original.call(this);
  };
  try {
    run();
  } finally {
    proto.flush = original;
  }
  return flushes;
}

describe("capability provenance — Windows CI write-amplification guard", () => {
  test("ONE CapabilityService.list() performs a constant number of graph rewrites", () => {
    const service = new CapabilityService(new Store(join(root, "guard.db")));
    // Warm the graph so we measure steady state, not first-observation writes.
    service.list();
    const flushes = countFlushes(() => {
      service.list();
    });
    // Pre-fix: one full-graph rewrite PER descriptor (~153). Post-fix: one
    // batched rewrite. A small constant keeps headroom without permitting a
    // return to O(descriptors) write amplification.
    expect(flushes).toBeLessThanOrEqual(4);
  });

  test("list() rewrite count does not scale with the descriptor count", () => {
    const service = new CapabilityService(new Store(join(root, "scale.db")));
    const descriptorCount = service.list().length;
    // A real catalogue, otherwise this assertion proves nothing.
    expect(descriptorCount).toBeGreaterThan(50);
    const flushes = countFlushes(() => {
      service.list();
    });
    expect(flushes).toBeLessThan(descriptorCount / 10);
  });

  test("a fresh store per mutation is what amplified writes — batching avoids it", () => {
    const rows = Array.from({ length: 60 }, (_, i) => descriptor(i));

    // The exact pre-fix shape: allocate a NEW store per descriptor. Every new
    // store has hasFlushed=false, so its first mutation flushes unconditionally
    // and the write-behind throttle can never engage.
    const perRowStores = countFlushes(() => {
      for (const row of rows) new CapabilityProvenanceStore().indexDescriptor(row);
    });
    expect(perRowStores).toBeGreaterThanOrEqual(rows.length);

    // The fix: ONE store, ONE batch, a bounded number of rewrites.
    process.env.XR_HOME = join(root, "home-batched");
    mkdirSync(process.env.XR_HOME, { recursive: true });
    const batched = countFlushes(() => {
      new CapabilityProvenanceStore().indexDescriptors(rows);
    });
    expect(batched).toBeLessThanOrEqual(2);
    expect(batched).toBeGreaterThan(0); // still durable — not a silent no-op
    expect(batched * 10).toBeLessThan(perRowStores);
  });

  test("batching preserves graph semantics exactly (same nodes and events)", () => {
    const rows = Array.from({ length: 25 }, (_, i) => descriptor(i));

    const batched = new CapabilityProvenanceStore();
    batched.indexDescriptors(rows);

    process.env.XR_HOME = join(root, "home-single");
    mkdirSync(process.env.XR_HOME, { recursive: true });
    const single = new CapabilityProvenanceStore();
    for (const row of rows) single.indexDescriptor(row);

    for (const row of rows) {
      const fromBatch = batched.provenanceOf(row.id);
      const fromSingle = single.provenanceOf(row.id);
      expect(fromBatch).not.toBeNull();
      expect(fromSingle).not.toBeNull();
      expect(fromBatch!.node.version).toBe(fromSingle!.node.version);
      expect(fromBatch!.events.map((e) => e.kind)).toEqual(fromSingle!.events.map((e) => e.kind));
    }
  });

  test("a first observation still records exactly one install event", () => {
    const store = new CapabilityProvenanceStore();
    store.indexDescriptors([descriptor(1), descriptor(2)]);
    const p = store.provenanceOf("tool:amp-1");
    expect(p).not.toBeNull();
    expect(p!.events.filter((e) => e.kind === "install")).toHaveLength(1);
  });

  test("re-indexing an unchanged descriptor adds no duplicate events", () => {
    const store = new CapabilityProvenanceStore();
    const rows = [descriptor(7)];
    store.indexDescriptors(rows);
    store.indexDescriptors(rows);
    store.indexDescriptors(rows);
    const p = store.provenanceOf("tool:amp-7");
    expect(p!.events.filter((e) => e.kind === "install")).toHaveLength(1);
    expect(p!.events.filter((e) => e.kind === "update")).toHaveLength(0);
  });
});
