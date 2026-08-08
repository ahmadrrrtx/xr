/**
 * XR Phase 7 · T1 — Provenance Graph tests.
 *
 * Proves: full provenance of a capability is queryable (origin/version/
 * publisher/permissions/deps/placement/update-history/outcomes) and
 * "what did the agent use?" is answerable — while distinct runtime semantics
 * (plugin ≠ skill ≠ mcp) are preserved.
 */
import { beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "xr-provenance-"));
process.env.XR_HOME = join(root, "home");
mkdirSync(process.env.XR_HOME, { recursive: true });

import { CapabilityProvenanceStore, PROVENANCE_BOUNDS } from "../../src/platform/capabilities/provenance.ts";
import { capabilityId } from "../../src/platform/capabilities/types.ts";
import { CapabilityService } from "../../src/platform/capabilities/service.ts";
import { Store } from "../../src/state/workspace-store.ts";

let store: Store;

beforeEach(() => {
  const home = process.env.XR_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  store = new Store(join(root, `db-${Math.random().toString(36).slice(2)}.db`));
});

test("provenanceOf returns full chain: origin, versions, permissions, deps, placement, update history, outcomes", () => {
  const p = new CapabilityProvenanceStore();
  const skillId = capabilityId("skill", "research:deep");

  // Origin: descriptor indexed (v1).
  p.recordEvent(skillId, "install", { actor: "user", detail: "v1.0.0 installed", outcome: { status: "success" } });
  p.recordEdge(skillId, "tool:web_search", "depends-on", { version: "1.0.0", detail: "tool" });
  p.recordEvent(skillId, "enable", { actor: "user" });
  p.recordUse(skillId, { runId: "env_run1", outcome: { status: "success" }, detail: "used for research task" });
  p.recordUse(skillId, { runId: "env_run2", outcome: { status: "failure" }, detail: "provider unavailable" });
  // Update + rollback history.
  p.recordEvent(skillId, "update", { actor: "user", detail: "1.0.0 → 1.1.0" });
  p.recordEvent(skillId, "rollback", { actor: "user", detail: "1.0.0" });
  // Version change captured by descriptor indexing.
  p.recordEvent(skillId, "certify", { outcome: { status: "success", detail: "xr-tested" } });

  const prov = p.provenanceOf(skillId);
  expect(prov).not.toBeNull();
  expect(prov!.node.capabilityId).toBe(skillId);
  expect(prov!.node.type).toBe("skill");
  expect(prov!.summary.installs).toBe(1);
  expect(prov!.summary.updates).toBe(1);
  expect(prov!.summary.rollbacks).toBe(1);
  expect(prov!.summary.uses).toBe(2);
  expect(prov!.summary.successes).toBe(1);
  expect(prov!.summary.failures).toBe(1);
  // Dependency edge recorded and queryable.
  expect(prov!.outgoing.some((e) => e.kind === "depends-on" && e.to === "tool:web_search")).toBe(true);
  // Events ordered and complete.
  expect(prov!.events.map((e) => e.kind)).toContain("install");
  expect(prov!.events.map((e) => e.kind)).toContain("enable");
  expect(prov!.events.map((e) => e.kind)).toContain("rollback");
  expect(prov!.events.map((e) => e.kind)).toContain("certify");
});

test('whatWasUsed answers "what did the agent use?" with outcomes', () => {
  const p = new CapabilityProvenanceStore();
  p.recordUse("tool:web_search", { runId: "env_a", outcome: { status: "success" } });
  p.recordUse("tool:web_search", { runId: "env_a", outcome: { status: "failure" } });
  p.recordUse("plugin:hello", { runId: "env_a", outcome: { status: "success" } });
  p.recordUse("tool:web_search", { runId: "env_b", outcome: { status: "success" } });

  const runA = p.whatWasUsed({ runId: "env_a" });
  expect(runA.length).toBe(2);
  const web = runA.find((r) => r.capabilityId === "tool:web_search")!;
  expect(web.uses).toBe(2);
  expect(web.outcomes).toEqual({ success: 1, failure: 1, unknown: 0 });
  const all = p.whatWasUsed();
  expect(all.length).toBe(2); // two distinct capabilities across runs
  expect(all.find((r) => r.capabilityId === "tool:web_search")!.uses).toBe(3);
});

test("distinct runtime semantics preserved: typed nodes never collapse planes", () => {
  const p = new CapabilityProvenanceStore();
  p.recordUse("plugin:executor", { runId: "r1" });
  p.recordUse("skill:prompt-pack", { runId: "r1" });
  p.recordUse("mcp:filesystem", { runId: "r1" });
  const used = p.whatWasUsed({ runId: "r1" });
  expect(used.map((u) => u.capabilityId).sort()).toEqual(["mcp:filesystem", "plugin:executor", "skill:prompt-pack"]);
  // Each remains its own typed node — no single "extension" bucket.
  expect(used.map((u) => u.type).sort()).toEqual(["mcp", "plugin", "skill"]);
});

test("descriptor indexing records dependency edges and version updates", () => {
  const service = new CapabilityService(store);
  // Any list() call indexes bundled descriptors into the graph.
  const rows = service.list();
  expect(rows.length).toBeGreaterThan(0);
  const graph = service.provenanceGraph();
  expect(graph.nodes.length).toBeGreaterThanOrEqual(rows.length);
  expect(graph.edges.length).toBeGreaterThan(0);

  // provenanceOf resolves by descriptor id.
  const first = rows[0];
  const prov = service.provenanceOf(first.id);
  expect(prov).not.toBeNull();
  expect(prov!.node.type).toBe(first.type);
  expect(prov!.node.version).toBe(first.version);
  expect(prov!.node.publisherId).toBe(first.publisher.id);
});

test("recordUse through the capability service records tool-plane uses", () => {
  const service = new CapabilityService(store);
  service.recordUse("tool:read_file", { runId: "env_x", outcome: "success" });
  const used = service.whatWasUsed({ runId: "env_x" });
  expect(used.length).toBe(1);
  expect(used[0].capabilityId).toBe("tool:read_file");
  expect(used[0].outcomes.success).toBe(1);
});

// R-8: 8,200 recordEvent calls each pay an O(events) per-capability prune
// rebuild once the 500-event floor is crossed (~4 s of CPU). Correct but at
// ~80% of bun's 5 s default test timeout it flaked under parallel load
// (observed 5,021 ms once). The bound semantics are what this test pins — not
// prune speed — so it gets an explicit 15 s timeout; 3x observed headroom.
test("graph is bounded (endless-data protection)", () => {
  const p = new CapabilityProvenanceStore();
  for (let i = 0; i < PROVENANCE_BOUNDS.maxEvents + 200; i++) {
    p.recordEvent(`tool:t${i % 20}`, "use", {});
  }
  const graph = p.graph();
  expect(graph.events.length).toBeLessThanOrEqual(PROVENANCE_BOUNDS.maxEvents);
  // Per-capability bound respected.
  const perCap = graph.events.filter((e) => e.capabilityId === "tool:t0");
  expect(perCap.length).toBeLessThanOrEqual(PROVENANCE_BOUNDS.maxEventsPerCapability);
}, 15_000);

test("persistence round-trip: events survive a new store instance", () => {
  const path = join(root, "provenance-roundtrip.json");
  const p1 = new CapabilityProvenanceStore(path);
  p1.recordUse("tool:web_search", { outcome: { status: "success" } });
  const p2 = new CapabilityProvenanceStore(path);
  expect(p2.whatWasUsed().length).toBe(1);
  expect(p2.whatWasUsed()[0].capabilityId).toBe("tool:web_search");
});
