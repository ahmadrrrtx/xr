/**
 * Phase 5 · ADR-0028 — core is buildable, testable and shippable WITHOUT the
 * satellites.
 *
 * The extraction is only real if it is enforced. A moved directory is a commit;
 * an invariant is a property. These tests are the invariant: they fail the
 * build the moment core reacquires a dependency on `satellites/`, which is the
 * exact way an extraction normally rots (someone needs one helper, adds one
 * import, and six months later the package is back in core in all but name).
 *
 * Three independent checks, because a single grep is easy to defeat:
 *   1. no source-level reference to the satellite paths (static, dynamic, or
 *      string-literal), across src/ AND the core test suite;
 *   2. the extracted trees are genuinely gone from src/;
 *   3. the npm `files` list cannot ship them.
 *
 * Related: `no-satellite-imports` in `.dependency-cruiser.cjs` (same invariant,
 * enforced by the boundaries gate over resolved module edges) and
 * `test/architecture/boundaries.test.ts` (same rule, over the in-tree graph).
 * Three enforcement points for one rule is deliberate here: this is the
 * property the whole phase is purchased with.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const SRC = join(ROOT, "src");
const TEST = join(ROOT, "test");

/** Paths that left core in Phase 5. */
const EXTRACTED = [
  "src/enterprise",
  "extensions/business-os",
  "satellites/xr-enterprise",
  "satellites/business-os",
] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * Comment-stripped source.
 *
 * Phase 5 deliberately left explanatory comments behind that NAME the old
 * paths ("this module used to live at extensions/business-os/…"): erasing that
 * history to satisfy a grep would make the tree less honest, not more. The
 * invariant is about code, so the check reads code only.
 */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("Phase 5 · satellite isolation (ADR-0028)", () => {
  test("no module under src/ references an extracted package", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const code = codeOf(file);
      for (const path of EXTRACTED) {
        if (code.includes(path)) {
          offenders.push(`${relative(ROOT, file)} references ${path}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no CORE test references an extracted package", () => {
    // The core suite must prove core in isolation. A core test reaching into a
    // satellite would make "core is green" depend on satellite code — the same
    // coupling through the back door.
    //
    // Two files are exempt because naming the extracted paths IS their job:
    // this file (which asserts their absence) and the boundaries test (which
    // walks the satellite tree when a dev checkout has one, to keep enforcing
    // L5 rules against it). Exempting the enforcers is not a loophole — the
    // rule they enforce is the one being tested, and both are architecture
    // tests that import no satellite CODE.
    const ENFORCERS = new Set([
      "test/architecture/satellite-isolation.test.ts",
      "test/architecture/boundaries.test.ts",
    ]);
    const offenders: string[] = [];
    for (const file of walk(TEST)) {
      if (ENFORCERS.has(relative(ROOT, file).replace(/\\/g, "/"))) continue;
      const code = codeOf(file);
      for (const path of EXTRACTED) {
        if (code.includes(path)) {
          offenders.push(`${relative(ROOT, file)} references ${path}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the extracted trees are absent from src/ and extensions/", () => {
    expect(existsSync(join(ROOT, "src/enterprise"))).toBe(false);
    expect(existsSync(join(ROOT, "extensions/business-os"))).toBe(false);
  });

  test("the npm files list cannot ship satellite code", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      files: string[];
    };
    for (const entry of pkg.files) {
      expect(entry.startsWith("satellites")).toBe(false);
      expect(entry.startsWith("extensions")).toBe(false);
    }
  });

  test("core still owns the L0 contracts the satellites build on", () => {
    // Extraction must not have taken the kernel-side contract with it: the
    // thin L0 record/artifact surface and the structural views the daemon and
    // credential vault consume are CORE code that the satellite satisfies.
    const l0 = readFileSync(join(SRC, "core/business-l0.ts"), "utf8");
    expect(l0).toContain("export interface BusinessOsExtension");
    expect(l0).toContain("export interface BusinessOsView");
    expect(l0).toContain("export interface BusinessSqlDatabase");
  });

  test("relocated CLI verbs report where they went instead of vanishing", async () => {
    const shims = await import("../../src/commands/satellite-shims.ts");
    for (const [verb, Ctor] of [
      ["enterprise", shims.EnterpriseCommand],
      ["evaluate", shims.EvaluateCommand],
      ["business", shims.BusinessCommand],
    ] as const) {
      const cmd = new Ctor();
      expect(cmd.name).toBe(verb);
      const notice = shims.relocationNotice(cmd.relocation);
      // The three things a user needs: what moved, where it went, how to get it.
      expect(notice).toContain(verb);
      expect(notice).toContain(cmd.relocation.pkg);
      expect(notice).toContain("bun add -g");
    }
  });

  test("a relocated verb exits non-zero — a moved feature is not a silent success", () => {
    // Cmdt 2: no success without a verified effect. `xr enterprise policy show`
    // on a core-only install did nothing, so it must not exit 0.
    const { EnterpriseCommand } = require("../../src/commands/satellite-shims.ts") as typeof import("../../src/commands/satellite-shims.ts");
    const cmd = new EnterpriseCommand();
    // `process.exitCode` is undefined until something sets it, and assigning
    // undefined back is a NO-OP in Bun — it does not clear a previously set
    // code. Restoring `prev` directly therefore left the runner holding 2, and
    // the whole suite exited 2 while reporting "0 fail": a green log with a red
    // exit code, which CI would have failed on with nothing to point at.
    // Coalesce to 0 so the restore actually restores.
    const prev = process.exitCode ?? 0;
    const log = console.log;
    console.log = () => {};
    try {
      cmd.execute({ args: [] } as never);
      expect(process.exitCode).toBe(2);
    } finally {
      console.log = log;
      process.exitCode = prev;
    }
  });
});
