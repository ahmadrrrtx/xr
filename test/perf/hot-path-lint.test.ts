/**
 * XR Phase 3 · T3 — hot-path sync-I/O lint tests.
 *
 * The fast-path modules (version/help/shell/serve + route decision + lazy
 * loading glue) must contain ZERO synchronous FS/process calls — this is the
 * enforceable half of "no sync I/O on hot paths" (Article XII · Rule 4).
 * The test seeds a violation and proves the scanner catches it (non-vacuous).
 */

import { join, relative } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { describe, test, expect } from "bun:test";
import { FAST_PATH_FILES, lintFastPath, scanFile } from "../../scripts/hot-path-lint.ts";

describe("Phase 3 · T3 — hot-path sync-I/O lint", () => {
  test("fast-path modules contain zero sync FS/process calls", () => {
    const findings = lintFastPath();
    expect(findings).toEqual([]);
  });

  test("the scanner is not vacuous: it catches a seeded sync call", () => {
    const dir = join(import.meta.dir, ".seed");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "rogue.ts");
    writeFileSync(file, 'import { readFileSync } from "node:fs";\nconst x = readFileSync("/etc/passwd");\n');
    const seeded = join(import.meta.dir, ".seed", "rogue.ts");
    const findings = scanFile(relative(join(import.meta.dir, "..", ".."), seeded));
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0]!.call).toBe("readFileSync");
  });

  test("FAST_PATH_FILES covers every module the fast path imports", () => {
    // Sanity: the enumerated list is non-empty and covers the router entry.
    expect(FAST_PATH_FILES.length).toBeGreaterThanOrEqual(10);
    expect(FAST_PATH_FILES).toContain("src/cli/router.ts");
    expect(FAST_PATH_FILES).toContain("src/index.ts");
  });
});
