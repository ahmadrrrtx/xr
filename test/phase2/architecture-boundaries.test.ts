/**
 * XR Phase 2 · Step 6 — DECISION BOUNDARY ARCHITECTURE TESTS.
 *
 * Two Phase-2 constitutional guarantees enforced as source-census tests
 * (same style as test/architecture/one-store.test.ts):
 *
 *  (a) NO CONSENT BYPASS — no module in src/ may build a `ctx.approve`
 *      implementation that can RETURN TRUE without a durable approval-store
 *      record. Hardcoded deny-all (`async () => false`) is permitted — it
 *      can never resolve an approval — and the in-process confirm() path is
 *      permitted only where it goes through makeApprover (store-backed).
 *
 *  (b) NO BUDGET DECISION OUTSIDE THE GOVERNOR — `.checkBudget(` may only be
 *      CALLED from the Governor (the loop facade) and the execution
 *      passthrough; `new BudgetManager(` may only appear in construction /
 *      factory sites; ad-hoc `isOverBudget` gates that BLOCK or REROUTE a
 *      call must go through the Governor. Status DISPLAY (commands, events)
 *      is allowed.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const FILES = walk(SRC).map((f) => relative(ROOT, f).replace(/\\/g, "/"));
const SOURCES = new Map(FILES.map((f) => [f, readFileSync(join(ROOT, f), "utf8")]));
const rel = (p: string): string => relative(ROOT, p).replaceAll("\\", "/");

/** Lines of `src` files whose text matches a pattern (with line numbers).
 *  Comment-only lines are skipped: censuses target executable code. */
function matchesIn(
  sources: Map<string, string>,
  files: string[],
  pattern: RegExp,
): Array<{ file: string; line: number; text: string }> {
  const out: Array<{ file: string; line: number; text: string }> = [];
  const isCommentOnly = (t: string) =>
    t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
  for (const file of files) {
    const lines = sources.get(file)!.split("\n");
    lines.forEach((text, i) => {
      const trimmed = text.trim();
      if (isCommentOnly(trimmed)) return;
      if (pattern.test(text)) out.push({ file, line: i + 1, text: trimmed });
    });
  }
  return out;
}

// ── The Phase 2 boundary predicates (pure over a source map) ─────────────────
// These are the DEFINITIONS the census enforces. The seeded-violation tests at
// the bottom feed them synthetic sources and prove they fire, so a green
// census means something.

/** (a) hardcoded approve impls that can return true without the store. */
function hardcodedApprovals(sources: Map<string, string>): ReturnType<typeof matchesIn> {
  const files = [...sources.keys()];
  const hardcode = matchesIn(
    sources,
    files,
    /approve:\s*(?:async\s*)?(?:\([^)]*\)\s*)?=>\s*(?:Promise\.resolve\()?(true|confirm|1)[)\s]*[,}]/,
  );
  const ignoreRequest = matchesIn(sources, files, /approve:\s*(?:async\s*)?\(/)
    .filter((h) => !/readonly|interface|^[\s*]*approve\?:/.test(h.text))
    .filter((h) => {
      const fileText = sources.get(h.file)!;
      if (/opts\.approve|deps\.approve|overrides\.approve|approvalStore|getApprovalStore|makeApprover/.test(fileText)) {
        return false;
      }
      const lines = fileText.split("\n");
      const window = lines.slice(h.line - 1, h.line + 8).join("\n");
      return !/return\s+false|\s*=>\s*false/.test(window);
    });
  return [...hardcode, ...ignoreRequest];
}

/** (b) budget decisions made outside the Governor. */
function budgetViolations(sources: Map<string, string>): ReturnType<typeof matchesIn> {
  const files = [...sources.keys()];
  const checkBudgetAllowed = new Set([
    "src/cost/governor.ts",
    "src/cost/manager.ts",
    "src/execution/service.ts",
  ]);
  const constructAllowed = new Set([
    "src/core/agent.ts",
    "src/cost/governor.ts",
    "src/research/budget.ts",
    "src/research/cli.ts",
    "src/plugins/host.ts",
    "src/services/budget-service.ts",
  ]);
  const overAllowed = new Set([
    "src/cost/manager.ts",
    "src/core/app.ts",
    "src/commands/budget.ts",
    "src/services/budget-service.ts",
  ]);
  return [
    ...matchesIn(sources, files, /\.checkBudget\s*\(/).filter((h) => !checkBudgetAllowed.has(h.file)),
    ...matchesIn(sources, files, /new\s+BudgetManager\s*\(/).filter((h) => !constructAllowed.has(h.file)),
    ...matchesIn(sources, files, /isOverBudget/).filter((h) => !overAllowed.has(h.file)),
  ];
}

describe("Phase 2 · (a) no consent resolution without a durable store record", () => {
  test("census: no hardcoded approving / request-ignoring ctx.approve implementation", () => {
    expect(hardcodedApprovals(SOURCES)).toEqual([]);
  });

  test("NEGATIVE CONTROL: a seeded bypass is detected", () => {
    const seeded = new Map<string, string>([
      ["src/evil.ts", "export const evil = { approve: async () => true };\n"],
      ["src/naive.ts", "export const naive = {\n  approve: async (req) => { await sleep(1); return Math.random() > 0.5; },\n};\n"],
    ]);
    const hits = hardcodedApprovals(seeded);
    expect([...new Set(hits.map((h) => h.file))].sort()).toEqual(["src/evil.ts", "src/naive.ts"]);
    // And a CLEAN synthetic source produces no hits.
    const clean = new Map<string, string>([
      [
        "src/ok.ts",
        "export const ok = {\n  approve: async (req) => approvalStore.request(req),\n};\n",
      ],
    ]);
    expect(hardcodedApprovals(clean)).toEqual([]);
  });
});

describe("Phase 2 · (b) no budget decision outside the Governor", () => {
  test("census: no ad-hoc budget decision (checkBudget/BudgetManager/isOverBudget gate)", () => {
    expect(budgetViolations(SOURCES)).toEqual([]);
  });

  test("NEGATIVE CONTROL: a seeded ad-hoc budget gate is detected", () => {
    const seeded = new Map<string, string>([
      [
        "src/rogue.ts",
        [
          "import { BudgetManager } from \"./cost/manager.ts\";",
          "export function gate(store) {",
          "  const bm = new BudgetManager(store);",
          "  if (bm.getStatus().isOverBudget) throw new Error(\"blocked\");",
          "}",
        ].join("\n"),
      ],
      ["src/rogue2.ts", "export const d = budgetManager.checkBudget(1.5);\n"],
    ]);
    const hits = budgetViolations(seeded);
    expect([...new Set(hits.map((h) => h.file))].sort()).toEqual(["src/rogue.ts", "src/rogue2.ts"]);
  });
});

describe("Phase 2 · seam integrity (regression census)", () => {
  test("no module bypasses the approval store by importing the legacy queue directly", () => {
    // The legacy control queue facade is store-backed and fails closed when
    // unbound; surfaces may import it ONLY to bind/list/decide (control
    // routes + control service). Tool/agent modules must go through
    // approval-store.ts.
    const importers = new Set<string>();
    for (const file of FILES) {
      if (/from\s+["'][^"']*control\/approvals\.ts["']/.test(SOURCES.get(file)!)) importers.add(file);
    }
    const allowed = new Set([
      "src/control/service.ts", // runAction binds the queue to the store
      "src/daemon/routes/control.routes.ts", // legacy dashboard endpoints
    ]);
    for (const importer of importers) {
      expect(allowed.has(importer), `${importer} imports the legacy approval queue`).toBe(true);
    }
  });

  test("every approval-surface module uses the durable store (census)", () => {
    // The surfaces that answer approvals must reference the approval store.
    const surfaces = [
      "src/telegram/bot.ts",
      "src/interfaces/shell/app.ts",
      "src/daemon/routes/chat.routes.ts",
      "src/daemon/routes/approvals.routes.ts",
      "src/services/agent-service.ts",
    ];
    for (const file of surfaces) {
      const text = SOURCES.get(file);
      expect(text, `${file} missing from src`).toBeTruthy();
      expect(
        /getApprovalStore|makeApprover|approval-store\.ts/.test(text!),
        `${file} must resolve approvals through the durable store`,
      ).toBe(true);
    }
  });
});
