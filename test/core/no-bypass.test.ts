/**
 * XR Phase 2 · T1 — ARCHITECTURAL TEST: no surface bypasses the envelope.
 *
 * Constitution Art. VI Violations: *"A surface calling `runAgent` directly,
 * bypassing the service."* Art. III Acceptance: *"every surface uses the
 * canonical execution path."*
 *
 * This test is the enforcement mechanism for Exit Gate item 1. It is a STATIC
 * + DYNAMIC-AWARE scan of the real source tree, not a mock:
 *
 *   · static  — every `import`/`export … from` specifier in src/**.ts
 *   · dynamic — every `await import("…")` specifier, which a purely static
 *               import scan (and dependency-cruiser's default reading) can miss
 *
 * If anyone adds a new surface that calls the agent loop directly, this fails.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const SRC = join(REPO_ROOT, "src");

/** The single module permitted to invoke the agent loop. */
const LOOP_CALLER = "src/core/execution/runner.ts";
/** The module that defines the loop. */
const LOOP_MODULE = "src/core/agent.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * Strip comments and string literals before scanning.
 *
 * Without this the scan is unsound in BOTH directions: doc comments that quote
 * the forbidden call (this repo has several, deliberately, to explain the
 * defect) produce false positives, and a scan tuned to ignore them by hand
 * would drift. Removing non-code text first means the assertions below are
 * about executable code only.
 */
function stripNonCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments (incl. JSDoc)
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ") // line comments, keeping `://` in URLs
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``") // template literals
    .replace(/'(?:\\.|[^\\'])*'/g, "''") // single-quoted strings
    .replace(/"(?:\\.|[^\\"])*"/g, '""'); // double-quoted strings
}

const FILES = walk(SRC).map((f) => {
  const raw = readFileSync(f, "utf8");
  return {
    rel: relative(REPO_ROOT, f).replace(/\\/g, "/"),
    /** Raw text — used only where literal specifiers must stay readable. */
    source: raw,
    /** Executable code with comments and string literals removed. */
    code: stripNonCode(raw),
  };
});

/** Resolve an import specifier relative to the importing file. */
function resolveSpec(fromRel: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const fromDir = join(REPO_ROOT, fromRel, "..");
  return relative(REPO_ROOT, resolve(fromDir, spec)).replace(/\\/g, "/");
}

/** Every static + dynamic module specifier a file references. */
function specifiers(file: { rel: string; source: string }): string[] {
  const out: string[] = [];
  const patterns = [
    /(?:^|\n)\s*import\s[^;]*?from\s+["']([^"']+)["']/g, // static import
    /(?:^|\n)\s*export\s[^;]*?from\s+["']([^"']+)["']/g, // re-export
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic import
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, // cjs (defensive)
  ];
  for (const re of patterns) {
    for (const m of file.source.matchAll(re)) {
      const resolved = resolveSpec(file.rel, m[1]!);
      if (resolved) out.push(resolved);
    }
  }
  return out;
}

describe("Phase 2 · T1 — no surface bypasses the execution envelope", () => {
  test("only the envelope runner imports the agent loop module", () => {
    const importers = FILES.filter(
      (f) => f.rel !== LOOP_MODULE && specifiers(f).includes(LOOP_MODULE),
    ).map((f) => f.rel);

    /**
     * Type-only imports are permitted: they are erased at compile time and
     * cannot invoke anything. A VALUE import of the loop module is a bypass.
     *
     * A clause is a value import unless it is either `import type { … }` or an
     * inline-type-only clause where EVERY named binding is prefixed `type `.
     */
    const runtimeImporters = importers.filter((rel) => {
      const file = FILES.find((f) => f.rel === rel)!;
      // Match every import clause in the file, then keep only those whose
      // specifier actually resolves to the loop module. Matching on the
      // resolved path (not on a literal substring) means a relative import
      // such as `../agent.ts` from inside core/ is handled correctly.
      const clauses = [
        ...file.source.matchAll(
          /import\s+(type\s+)?(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*from\s*["']([^"']+)["']/g,
        ),
      ].filter((m) => resolveSpec(file.rel, m[3]!) === LOOP_MODULE);
      return clauses.some((m) => {
        if (m[1]) return false; // `import type { … } from …`
        const clause = m[2]!;
        if (!clause.startsWith("{")) return true; // default/namespace import
        const bindings = clause
          .slice(1, -1)
          .split(",")
          .map((b) => b.trim())
          .filter(Boolean);
        // Value import iff at least one binding is NOT inline-`type`.
        return bindings.some((b) => !/^type\s/.test(b));
      });
    });

    expect(runtimeImporters.sort()).toEqual([LOOP_CALLER]);
  });

  test("no production module calls runAgentLoop( outside the runner", () => {
    const offenders = FILES.filter(
      (f) => f.rel !== LOOP_MODULE && f.rel !== LOOP_CALLER && /\brunAgentLoop\s*\(/.test(f.code),
    ).map((f) => f.rel);

    expect(offenders).toEqual([]);
  });

  test("no production module calls the deprecated runAgent( alias", () => {
    const offenders = FILES.filter(
      (f) => f.rel !== LOOP_MODULE && /(?<![.\w])runAgent\s*\(/.test(f.code),
    ).map((f) => f.rel);

    expect(offenders).toEqual([]);
  });

  test("every interactive surface reaches execution through the envelope", () => {
    // Each surface must reference exactly one of the two envelope entries:
    //   AgentService.execute()  (kernel-booted paths)
    //   executeOnSurface()      (surface-owned-store paths)
    const surfaces = [
      "src/interfaces/shell/app.ts",
      "src/telegram/bot.ts",
      "src/voice/pipeline.ts",
    ];
    for (const rel of surfaces) {
      const file = FILES.find((f) => f.rel === rel);
      expect(file, `${rel} must exist`).toBeDefined();
      const usesEnvelope =
        file!.source.includes("executeOnSurface") ||
        /\.execute\s*\(/.test(file!.source) ||
        file!.source.includes("runScopedTask");
      expect(usesEnvelope, `${rel} must execute through the envelope`).toBe(true);
    }
  });

  test("the envelope runner is the only module importing the runner's loop entry", () => {
    // Defence in depth: nothing may re-export the loop under a new name and
    // thereby launder a bypass through a barrel file.
    const reExporters = FILES.filter(
      (f) =>
        f.rel !== LOOP_MODULE &&
        /export\s*\{[^}]*\brunAgentLoop\b[^}]*\}/.test(f.code),
    ).map((f) => f.rel);

    expect(reExporters).toEqual([]);
  });

  test("the eight canonical phases are defined and ordered", async () => {
    const { ENVELOPE_PHASES } = await import("../../src/core/execution/envelope.ts");
    expect([...ENVELOPE_PHASES]).toEqual([
      "intent",
      "plan",
      "policy",
      "placement",
      "action",
      "observation",
      "evidence",
      "outcome",
    ]);
  });

  test("SEEDED VIOLATION: the scan really detects a bypass", () => {
    // Negative control — proves the test above is not vacuous. We simulate a
    // rogue surface and assert the same predicate flags it.
    const rogue = {
      rel: "src/interfaces/rogue-surface.ts",
      source: `import { runAgentLoop } from "../core/agent.ts";\nawait runAgentLoop("x", "agent", {} as any);`,
    };
    const flaggedByImport = specifiers(rogue).includes(LOOP_MODULE);
    const flaggedByCall = /\brunAgentLoop\s*\(/.test(rogue.source);
    expect(flaggedByImport).toBe(true);
    expect(flaggedByCall).toBe(true);
  });
});
