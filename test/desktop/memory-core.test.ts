/**
 * Phase 21 — Memory Explorer pure core (desktop/src/memory/core.ts): filters,
 * expiry, linked entries, highlights, import preview, undo payload, graph
 * layout and outline. Relative imports, same convention as the other desktop tests.
 */
import { describe, expect, test } from "bun:test";

import {
  countByCategory,
  expiryOptionFor,
  expiryText,
  filterMemories,
  graphOutline,
  highlightSegments,
  layoutGraph,
  linkedEntries,
  neighborhood,
  nodeRadius,
  parseTags,
  previewImport,
  restoreBody,
  scopeKind,
  summarize,
  type MemoryGraphData,
  type MemoryView,
} from "../../desktop/src/memory/core.ts";

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function mem(over: Partial<MemoryView> & { id: string; content: string }): MemoryView {
  return {
    category: "fact",
    scope: "global",
    source: "user",
    kind: "fact",
    tags: [],
    importance: 3,
    expiresAt: null,
    createdAt: NOW - DAY,
    updatedAt: NOW - DAY,
    lastAccessedAt: null,
    accessCount: 0,
    consentState: "approved",
    provenanceKind: null,
    provenanceRef: null,
    sensitive: [],
    ...over,
  };
}

const sample: MemoryView[] = [
  mem({ id: "a", content: "I prefer Vim bindings", category: "preference", importance: 4, updatedAt: NOW - 1000 }),
  mem({ id: "b", content: "Project XR uses Tauri", category: "project", scope: "workspace:xr", tags: ["project:xr"], importance: 5 }),
  mem({ id: "c", content: "Sara Khan reviews PRs", category: "fact", tags: ["person:Sara Khan"], importance: 2 }),
  mem({ id: "d", content: "never store passwords", category: "exclusion", importance: 3 }),
  mem({ id: "e", content: "old trip note", expiresAt: NOW - DAY, importance: 1 }),
];

describe("filterMemories", () => {
  test("hides expired entries unless asked, and orders by importance", () => {
    const ids = filterMemories(sample, { now: NOW }).map((e) => e.id);
    expect(ids).not.toContain("e");
    expect(ids).toEqual(["b", "a", "d", "c"]);
    expect(filterMemories(sample, { now: NOW, showExpired: true }).map((e) => e.id)).toContain("e");
  });

  test("category and scope filters", () => {
    expect(filterMemories(sample, { now: NOW, category: "preference" }).map((e) => e.id)).toEqual(["a"]);
    expect(filterMemories(sample, { now: NOW, scope: "workspace" }).map((e) => e.id)).toEqual(["b"]);
    expect(filterMemories(sample, { now: NOW, scope: "global", category: "all" }).map((e) => e.id).sort()).toEqual(["a", "c", "d"]);
  });

  test("entities chip matches entries carrying an entity tag", () => {
    expect(filterMemories(sample, { now: NOW, category: "entities" }).map((e) => e.id).sort()).toEqual(["b", "c"]);
  });

  test("engine recall ids restrict the list", () => {
    expect(filterMemories(sample, { now: NOW, matchIds: new Set(["c", "a"]) }).map((e) => e.id)).toEqual(["a", "c"]);
  });

  test("counts follow the same visibility rules", () => {
    const counts = countByCategory(sample, NOW);
    expect(counts.all).toBe(4);
    expect(counts.entities).toBe(2);
    expect(counts.exclusion).toBe(1);
  });
});

describe("scope and expiry", () => {
  test("scopeKind treats only the literal global key as global", () => {
    expect(scopeKind("global")).toBe("global");
    expect(scopeKind("workspace")).toBe("workspace");
    expect(scopeKind("workspace:abc")).toBe("workspace");
    expect(scopeKind("xr")).toBe("workspace");
  });

  test("expiry labels and the nearest option for the editor", () => {
    expect(expiryText(null, NOW)).toBe("Never expires");
    expect(expiryText(NOW - 1, NOW)).toBe("Expired");
    expect(expiryText(NOW + 10 * DAY, NOW)).toBe("Expires in 10 days");
    expect(expiryOptionFor(null, NOW)).toBe(null);
    expect(expiryOptionFor(NOW + 28 * DAY, NOW)).toBe(30);
    expect(expiryOptionFor(NOW + 80 * DAY, NOW)).toBe(90);
  });
});

describe("linked, highlight and text helpers", () => {
  test("linked entries share a non-source tag, strongest overlap first", () => {
    const base = mem({ id: "x", content: "x", tags: ["project:xr", "tool:Vim", "source:import"] });
    const others = [
      mem({ id: "p", content: "p", tags: ["project:xr"], importance: 2 }),
      mem({ id: "q", content: "q", tags: ["project:xr", "tool:Vim"], importance: 1 }),
      mem({ id: "r", content: "r", tags: ["source:import"], importance: 5 }),
    ];
    expect(linkedEntries(base, others).map((e) => e.id)).toEqual(["q", "p"]);
  });

  test("highlights are case-insensitive and never emit markup", () => {
    const segs = highlightSegments("Use vim and VIM <b>", "vim");
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(["vim", "VIM"]);
    expect(segs.map((s) => s.text).join("")).toBe("Use vim and VIM <b>");
  });

  test("summarize collapses whitespace and clips", () => {
    expect(summarize("a   b\n c", 80)).toBe("a b c");
    expect(summarize("x".repeat(100), 10).length).toBe(10);
  });

  test("parseTags trims, lowercases, dedupes and caps", () => {
    expect(parseTags(" Vim, vim ,  ,Tauri")).toEqual(["vim", "tauri"]);
    expect(parseTags(Array.from({ length: 30 }, (_, i) => `t${i}`).join(",")).length).toBe(20);
  });
});

describe("import preview and undo payload", () => {
  test("accepts an xr-memory bundle and counts entries", () => {
    expect(previewImport(JSON.stringify({ format: "xr-memory", entries: [{}, {}] }))).toEqual({ ok: true, count: 2 });
  });

  test("rejects non-JSON, foreign formats and oversize bundles", () => {
    expect(previewImport("not json").ok).toBe(false);
    expect(previewImport(JSON.stringify({ format: "other", entries: [] })).ok).toBe(false);
    const big = { format: "xr-memory", entries: Array.from({ length: 5001 }, () => ({})) };
    expect(previewImport(JSON.stringify(big)).ok).toBe(false);
  });

  test("restoreBody keeps content, scope, tags, importance and expiry; drops engine-only fields", () => {
    const e = mem({ id: "z", content: "Tauri v2", scope: "workspace:xr", tags: ["project:xr", "source:import"], importance: 4, expiresAt: NOW + 5 * DAY });
    const body = restoreBody(e);
    expect(body.content).toBe("Tauri v2");
    expect(body.scope).toBe("workspace:xr");
    expect(body.tags).toEqual(["project:xr"]);
    expect(body.importance).toBe(4);
    expect(body.expiresInDays).toBeGreaterThan(0);
    expect(body).not.toHaveProperty("id");
  });
});

describe("graph helpers", () => {
  const graph: MemoryGraphData = {
    method: "heuristic",
    root: "me",
    truncated: false,
    nodes: [
      { id: "me", kind: "you", label: "You", importance: 5, memoryIds: [], linkCount: 2 },
      { id: "fact:a", kind: "fact", label: "I prefer Vim", importance: 4, memoryIds: ["a"], linkCount: 2 },
      { id: "tool:vim", kind: "tool", label: "Vim", importance: 4, memoryIds: ["a"], linkCount: 2 },
      { id: "person:sara khan", kind: "person", label: "Sara Khan", importance: 2, memoryIds: ["c"], linkCount: 1 },
    ],
    edges: [
      { id: "e1", source: "me", target: "fact:a", relation: "remembers" },
      { id: "e2", source: "fact:a", target: "tool:vim", relation: "uses" },
      { id: "e3", source: "me", target: "person:sara khan", relation: "knows" },
    ],
  };

  test("layout is deterministic, finite, and pins You at the origin", () => {
    const a = layoutGraph(graph);
    const b = layoutGraph(graph);
    expect(a.get("me")).toEqual({ x: 0, y: 0 });
    for (const n of graph.nodes) {
      const p = a.get(n.id)!;
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(b.get(n.id)).toEqual(p);
    }
  });

  test("layout stays bounded even for a dense start", () => {
    const nodes = Array.from({ length: 120 }, (_, i) => ({ id: `fact:${i}`, kind: "fact" as const, label: `${i}`, importance: 3, memoryIds: [], linkCount: 1 }));
    const edges = nodes.slice(1).map((n, i) => ({ id: `x${i}`, source: nodes[0]!.id, target: n.id, relation: "r" }));
    const pos = layoutGraph({ nodes: [{ id: "me", kind: "you", label: "You", importance: 5, memoryIds: [], linkCount: 0 }, ...nodes], edges });
    for (const p of pos.values()) expect(Math.hypot(p.x, p.y)).toBeLessThan(2000);
  });

  test("node radius: You is largest; others stay within 8–22 px", () => {
    expect(nodeRadius({ kind: "you", importance: 1, linkCount: 0 })).toBe(30);
    for (const imp of [1, 3, 5]) for (const lc of [0, 3, 50]) {
      const r = nodeRadius({ kind: "tool", importance: imp, linkCount: lc });
      expect(r).toBeGreaterThanOrEqual(8);
      expect(r).toBeLessThanOrEqual(22);
    }
  });

  test("neighbourhood lists the hovered node, its neighbours and touching edges", () => {
    const n = neighborhood(graph, "fact:a");
    expect([...n.nodes].sort()).toEqual(["fact:a", "me", "tool:vim"]);
    expect([...n.edges].sort()).toEqual(["e1", "e2"]);
    expect(neighborhood(graph, null).nodes.size).toBe(0);
  });

  test("text outline groups entities and their relations", () => {
    const groups = graphOutline(graph);
    const headings = groups.map((g) => g.heading);
    expect(headings).toEqual(["People", "Tools", "Memories"]);
    expect(groups.find((g) => g.heading === "Tools")!.items[0]).toContain("uses I prefer Vim");
  });
});
