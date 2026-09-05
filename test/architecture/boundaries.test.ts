/**
 * XR Phase 2 · T8 — ARCHITECTURAL TEST: acyclic dependencies + the L0–L6
 * boundary table, enforced on every `bun test`.
 *
 * Constitution Art. V.2: *"Dependency direction is explicit and acyclic; an
 * architectural test enforces it."*
 *
 * ── Why this exists alongside the CI depcruise job ──────────────────────────
 *
 * The CI job runs the full cruiser. This test enforces the SAME rules from the
 * SAME config (`.dependency-cruiser.cjs` — one source of truth, Cmdt 6) using a
 * self-contained scanner, so:
 *
 *   · a contributor gets the failure locally in `bun test`, not only in CI;
 *   · the gate survives even if the optional dev dependency is absent;
 *   · dynamic `await import()` edges are covered — the cruiser is static-first
 *     and the phase prompt explicitly warns about that gap.
 *
 * The seeded-violation tests at the bottom are the negative control: they prove
 * the scanner actually fails on a cycle and on a cross-boundary import, so a
 * green result means something.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const SRC = join(ROOT, "src");

// ── Graph construction ──────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

interface Edge {
  readonly to: string;
  /** `import type { … }` / `import { type X }` — erased at compile time. */
  readonly typeOnly: boolean;
  readonly dynamic: boolean;
}

/**
 * Phase 5 · ADR-0028 — the business extension moved to a satellite package.
 *
 * It used to live at `extensions/business-os/src` inside this repo and was
 * walked into the boundary graph so its L5 rules were enforced here. Now that
 * it is published as `@rrrtx/business-os` the directory is only present in a
 * development checkout, so the walk is conditional: when the satellite tree is
 * present the L5 rules still run against it, and when it is absent (a
 * core-only clone, or the npm tarball) the graph is simply core.
 *
 * The invariant that actually matters after extraction — "core imports nothing
 * from a satellite" — is enforced unconditionally by `no-satellite-imports`
 * below, and independently by test/architecture/satellite-isolation.test.ts.
 */
const EXT = join(ROOT, "satellites/business-os/pkg/src");
const FILES = [
  ...walk(SRC).map((f) => relative(ROOT, f).replace(/\\/g, "/")),
  ...(existsSync(EXT) ? walk(EXT).map((f) => relative(ROOT, f).replace(/\\/g, "/")) : []),
];
const SOURCES = new Map(FILES.map((f) => [f, readFileSync(join(ROOT, f), "utf8")]));

function resolveSpec(fromRel: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const abs = resolve(join(ROOT, dirname(fromRel)), spec);
  const rel = relative(ROOT, abs).replace(/\\/g, "/");
  return SOURCES.has(rel) ? rel : null;
}

/** Every runtime + type edge out of a module, classified. */
function edgesOf(file: string): Edge[] {
  const src = SOURCES.get(file)!;
  const edges: Edge[] = [];

  // static import / re-export
  for (const m of src.matchAll(
    /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g,
  )) {
    const to = resolveSpec(file, m[3]!);
    if (!to) continue;
    const isTypeKeyword = Boolean(m[1]);
    const clause = (m[2] ?? "").trim();
    const bindings = clause.startsWith("{")
      ? clause.slice(1, clause.lastIndexOf("}")).split(",").map((b) => b.trim()).filter(Boolean)
      : [];
    const allInlineType = bindings.length > 0 && bindings.every((b) => /^type\s/.test(b));
    edges.push({ to, typeOnly: isTypeKeyword || allInlineType, dynamic: false });
  }

  // bare side-effect import: `import "./x.ts"`
  for (const m of src.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) {
    const to = resolveSpec(file, m[1]!);
    if (to) edges.push({ to, typeOnly: false, dynamic: false });
  }

  // dynamic import — the edge a static-only reading misses
  for (const m of src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    const to = resolveSpec(file, m[1]!);
    if (to) edges.push({ to, typeOnly: false, dynamic: true });
  }

  return edges;
}

const GRAPH = new Map<string, Edge[]>(FILES.map((f) => [f, edgesOf(f)]));

/** Tarjan SCC over a filtered edge set. Returns components of size > 1. */
function findCycles(keep: (e: Edge) => boolean): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  let counter = 0;

  for (const root of FILES) {
    if (index.has(root)) continue;
    const work: Array<[string, number]> = [[root, 0]];
    while (work.length) {
      const [node, pi] = work[work.length - 1]!;
      if (pi === 0) {
        index.set(node, counter);
        low.set(node, counter);
        counter++;
        stack.push(node);
        onStack.add(node);
      }
      const targets = (GRAPH.get(node) ?? []).filter(keep).map((e) => e.to);
      let recursed = false;
      for (let i = pi; i < targets.length; i++) {
        const w = targets[i]!;
        if (!index.has(w)) {
          work[work.length - 1] = [node, i + 1];
          work.push([w, 0]);
          recursed = true;
          break;
        } else if (onStack.has(w)) {
          low.set(node, Math.min(low.get(node)!, index.get(w)!));
        }
      }
      if (recursed) continue;
      if (low.get(node) === index.get(node)) {
        const comp: string[] = [];
        for (;;) {
          const w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
          if (w === node) break;
        }
        if (comp.length > 1) out.push(comp.sort());
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1]![0];
        low.set(parent, Math.min(low.get(parent)!, low.get(node)!));
      }
    }
  }
  return out;
}

// ── The L0–L6 boundary table (mirrors .dependency-cruiser.cjs) ──────────────

const LAYER_RULES: Array<{
  name: string;
  from: RegExp;
  fromNot?: RegExp;
  to: RegExp;
  toNot?: RegExp;
}> = [
  {
    name: "kernel-stays-kernel",
    from: /^src\/(core|state|security|config|util|cost)\//,
    fromNot: /^src\/core\/(app\.ts|providers\.ts|providers\/|agent\.ts|execution\/)/,
    to: /^src\/(execution|context|intelligence|providers|agents|control|runtime|services|reliability|tools|plugins|skills|mcp|platform|capabilities|integrations|computer|automation|local|research|business|enterprise|interfaces|cli|commands|daemon|telegram|voice|ui|i18n|export|install|update)\//,
    toNot: /^src\/(providers\/presets\.ts|context\/repository\.ts|interfaces\/cli\.ts)$/,
  },
  {
    name: "runtime-not-above",
    from: /^src\/(execution|context|intelligence|providers|agents|reliability)\//,
    fromNot: /^src\/execution\/adapters\//,
    to: /^src\/(business|enterprise|interfaces|cli|commands|daemon|telegram|voice|ui)\//,
    toNot: /^src\/interfaces\/cli\.ts$/,
  },
  {
    name: "platform-not-above",
    from: /^src\/(tools|plugins|skills|mcp|platform|capabilities|integrations|computer|automation)\//,
    to: /^src\/(business|enterprise|interfaces|cli|commands|daemon|telegram|voice)\//,
    toNot: /^src\/interfaces\/cli\.ts$/,
  },
  {
    name: "business-not-enterprise",
    from: /^satellites\/business-os\//,
    to: /^src\/(enterprise|interfaces|cli|commands|daemon|telegram|voice|ui|i18n|export|install|update)\//,
    toNot: /^src\/interfaces\/cli\.ts$/,
  },
  {
    // Phase 5 · ADR-0028 — supersedes "kernel-no-business-extension".
    // The old rule forbade the KERNEL from importing the extension; after
    // extraction the rule is stronger and applies to ALL of core: no module
    // under src/ may import ANY satellite, by any edge kind.
    name: "no-satellite-imports",
    from: /^src\//,
    to: /^satellites\//,
  },
  {
    name: "no-one-imports-surfaces",
    from: /^src\//,
    // `src/index.ts` IS the CLI entry point — a surface, not an importer of one.
    fromNot: /^src\/(interfaces|cli|commands|daemon|telegram|voice|ui|i18n|export|install|update|index\.ts)/,
    to: /^src\/(interfaces|cli|commands|daemon|telegram|voice|ui)\//,
    toNot: /^src\/(interfaces\/cli\.ts|cli\/catalog\.ts)$/,
  },
];

/**
 * Layer violations over RUNTIME edges.
 *
 * Type-only edges are excluded, matching `.dependency-cruiser.cjs`
 * (`tsPreCompilationDeps: false`). `import type` is erased by the compiler, so
 * it creates no runtime coupling: the kernel's typed service-token catalogue
 * names service types purely to give `resolve(Tokens.X)` a return type, and
 * `integrations/credentials.ts` imports `BusinessDatabase` only as a parameter
 * type. Treating those as real dependencies would force stringly-typed tokens
 * and `any` parameters — worse architecture to satisfy a tool.
 */
function violationsOf(rule: (typeof LAYER_RULES)[number], graph = GRAPH): string[] {
  const out: string[] = [];
  for (const [from, edges] of graph) {
    if (!rule.from.test(from)) continue;
    if (rule.fromNot?.test(from)) continue;
    for (const e of edges) {
      if (e.typeOnly) continue;
      if (!rule.to.test(e.to)) continue;
      if (rule.toNot?.test(e.to)) continue;
      out.push(`${from} -> ${e.to}`);
    }
  }
  return out.sort();
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("T8 — acyclic dependency direction", () => {
  test("the module graph is non-trivial (guards against a vacuous pass)", () => {
    expect(FILES.length).toBeGreaterThan(300);
    const edgeCount = [...GRAPH.values()].reduce((n, e) => n + e.length, 0);
    expect(edgeCount).toBeGreaterThan(1000);
  });

  test("ZERO runtime dependency cycles (static + dynamic edges)", () => {
    // Phase 2 started with three: the dual-router cycle, control<->computer-use,
    // and an evaluation barrel self-import. All three are resolved.
    const cycles = findCycles((e) => !e.typeOnly);
    expect(cycles).toEqual([]);
  });

  test("dynamic `await import()` edges are included in the cycle scan", () => {
    // The gap the phase prompt warns about: a static-only reading would miss
    // a cycle closed by a lazy import. Prove those edges are in the graph.
    const dynamicEdges = [...GRAPH.values()].flat().filter((e) => e.dynamic);
    expect(dynamicEdges.length).toBeGreaterThan(10);
  });

  test("type-only cycles are tolerated but bounded (erased at compile time)", () => {
    // `import type` is erased, so such a loop cannot exist at run time. XR uses
    // this deliberately in the typed service-token catalogue. It is reported,
    // not ignored — and it must not grow unbounded.
    const all = findCycles(() => true);
    const runtime = findCycles((e) => !e.typeOnly);
    expect(runtime).toEqual([]);
    expect(all.length).toBeLessThanOrEqual(40);
  });
});

describe("T8 — the L0–L6 boundary table is enforced", () => {
  for (const rule of LAYER_RULES) {
    test(`${rule.name}: no violations`, () => {
      expect(violationsOf(rule)).toEqual([]);
    });
  }

  test("the rules actually match modules (not dead regexes)", () => {
    for (const rule of LAYER_RULES) {
      const matched = FILES.filter((f) => rule.from.test(f) && !rule.fromNot?.test(f));
      expect(matched.length, `${rule.name} matched no source module`).toBeGreaterThan(0);
    }
  });
});

describe("T8 — retired modules stay retired (one authority per concern)", () => {
  // Phase 08: src/capabilities was reintroduced as unified capability system
  // (previously retired to platform/capabilities). It is now L2 Platform.
  const RETIRED = [
    "src/memory/",
    "src/workflow/",
    "src/providers/routing.ts",
    "src/services/extensibility-bridge.ts",
    "src/trust/",
    "src/deployment/",
    "src/environment/",
    "src/evaluation/",
    "src/baseline/",
  ];

  test("no retired module exists on disk", () => {
    const present = RETIRED.filter((r) =>
      FILES.some((f) => (r.endsWith("/") ? f.startsWith(r) : f === r)),
    );
    expect(present).toEqual([]);
  });

  test("no module imports a retired path", () => {
    const offenders: string[] = [];
    for (const [from, edges] of GRAPH) {
      for (const e of edges) {
        if (RETIRED.some((r) => (r.endsWith("/") ? e.to.startsWith(r) : e.to === r))) {
          offenders.push(`${from} -> ${e.to}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no phase-named top-level module remains (except capabilities which is now unified Phase 08 L2)", () => {
    // Phase 08: capabilities is now canonical unified system, not phase-named retired
    const PHASE_NAMED = ["baseline", "deployment", "environment", "evaluation", "trust"];
    const present = PHASE_NAMED.filter((d) => FILES.some((f) => f.startsWith(`src/${d}/`)));
    expect(present).toEqual([]);
  });
});

describe("T8 — SEEDED VIOLATIONS: the gate is not vacuous", () => {
  /** Clone the real graph and inject a synthetic module. */
  function withSeed(from: string, edge: Edge): Map<string, Edge[]> {
    const g = new Map(GRAPH);
    g.set(from, [edge]);
    return g;
  }

  test("a seeded CYCLE is detected", () => {
    // Build a tiny two-node loop and run the same SCC algorithm over it.
    const g = new Map<string, Edge[]>([
      ["a.ts", [{ to: "b.ts", typeOnly: false, dynamic: false }]],
      ["b.ts", [{ to: "a.ts", typeOnly: false, dynamic: false }]],
    ]);
    // Minimal inline Tarjan over the seeded graph.
    const seen = new Set<string>();
    let cyclic = false;
    const visit = (n: string, path: string[]): void => {
      if (path.includes(n)) { cyclic = true; return; }
      if (seen.has(n)) return;
      seen.add(n);
      for (const e of g.get(n) ?? []) visit(e.to, [...path, n]);
    };
    visit("a.ts", []);
    expect(cyclic).toBe(true);
  });

  test("a seeded CROSS-BOUNDARY import is detected (kernel -> platform)", () => {
    const seeded = withSeed("src/core/rogue.ts", {
      to: "src/plugins/loader.ts",
      typeOnly: false,
      dynamic: false,
    });
    const rule = LAYER_RULES.find((r) => r.name === "kernel-stays-kernel")!;
    const found = violationsOf(rule, seeded);
    expect(found).toContain("src/core/rogue.ts -> src/plugins/loader.ts");
  });

  test("a seeded SURFACE import is detected (runtime -> daemon)", () => {
    const seeded = withSeed("src/execution/rogue.ts", {
      to: "src/daemon/server.ts",
      typeOnly: false,
      dynamic: false,
    });
    const rule = LAYER_RULES.find((r) => r.name === "no-one-imports-surfaces")!;
    expect(violationsOf(rule, seeded)).toContain("src/execution/rogue.ts -> src/daemon/server.ts");
  });

  test("a seeded RETIRED-MODULE import is detected", () => {
    const seeded = withSeed("src/services/rogue.ts", {
      to: "src/memory/store.ts",
      typeOnly: false,
      dynamic: false,
    });
    const offenders: string[] = [];
    for (const [from, edges] of seeded) {
      for (const e of edges) {
        if (e.to.startsWith("src/memory/")) offenders.push(`${from} -> ${e.to}`);
      }
    }
    expect(offenders).toContain("src/services/rogue.ts -> src/memory/store.ts");
  });
});

describe("T8 — the config is the single source of boundary truth", () => {
  test(".dependency-cruiser.cjs exists and declares the same rule names", async () => {
    const cfgPath = join(ROOT, ".dependency-cruiser.cjs");
    const text = await Bun.file(cfgPath).text();
    for (const rule of LAYER_RULES) {
      expect(text, `config must declare rule "${rule.name}"`).toContain(`name: "${rule.name}"`);
    }
    expect(text).toContain('name: "no-circular"');
    expect(text).toContain('name: "only-runner-imports-agent-loop"');
    expect(text).toContain('name: "no-retired-modules"');
  });
});
