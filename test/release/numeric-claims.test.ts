/**
 * Fix-program Phase 1.3 — published numbers and doc links have a single
 * source of truth, and the gates that defend them actually bite.
 *
 * These tests exercise the REAL claim-lint scanners against the REAL tree
 * (README, canonical register, frozen release excerpts, RELEASING) plus
 * in-memory documents that must trip each rule. The suite deliberately does
 * NOT re-run bun test inside a test file: the measured tuple lives in
 * docs/release/TEST-BASELINE.json and is refreshed per RELEASING §1g.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../../scripts/release-manifest.ts";
import { TREE_CEILING } from "../../scripts/size-gate.ts";
import {
  lintDocsIntegrity,
  scanDocLinks,
  scanNumericClaims,
  TEST_BASELINE_PATH,
} from "../../scripts/claim-lint.ts";

const comma = TREE_CEILING.toLocaleString("en-US");

describe("ceiling consistency — every published ceiling claim equals TREE_CEILING", () => {
  test("the whole tree is clean: lintDocsIntegrity finds zero violations", () => {
    expect(lintDocsIntegrity()).toEqual([]);
  });

  test("the README gates table carries the stamped marker with the real value", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    expect(readme).toContain(`<!-- XR:TREE-CEILING -->${comma}<!-- /XR:TREE-CEILING -->`);
  });

  test("no present-tense LOC figure outside a marker disagrees with TREE_CEILING", () => {
    for (const f of ["docs/security/KNOWN_LIMITATIONS.md", "README.md"]) {
      const text = readFileSync(join(ROOT, f), "utf8");
      const violations = scanNumericClaims(text, join(ROOT, f), JSON.parse(readFileSync(join(ROOT, TEST_BASELINE_PATH), "utf8")));
      expect(violations.filter((v) => v.reason.includes("LOC"))).toEqual([]);
    }
  });
});

describe("test-count tuple — README equals the measured baseline", () => {
  const baseline = JSON.parse(readFileSync(join(ROOT, TEST_BASELINE_PATH), "utf8"));
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const tuple = readme.match(/([\d,]+) pass \/ (\d+) skip \/ (\d+) fail across ([\d,]+) files/);

  test("the README states the tuple and it matches TEST-BASELINE.json exactly", () => {
    expect(tuple).not.toBeNull();
    expect(parseInt(tuple![1].replace(/,/g, ""), 10)).toBe(baseline.pass);
    expect(parseInt(tuple![2], 10)).toBe(baseline.skip);
    expect(parseInt(tuple![3], 10)).toBe(baseline.fail);
    expect(parseInt(tuple![4].replace(/,/g, ""), 10)).toBe(baseline.files);
  });

  test("the baseline carries its measurement method (bun version, lane, commit, date)", () => {
    expect(baseline.bunVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(baseline.lane).toBe("linux");
    expect(baseline.commit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(baseline.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("doc links — every relative link in the published docs resolves", () => {
  test("the README's generated register link target exists (1.1.0 excerpt)", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    expect(readme).toContain("docs/release/1.1.0/known-limitations.md");
    expect(scanDocLinks(readme, join(ROOT, "README.md"))).toEqual([]);
  });

  test("the canonical register's links all resolve in-tree", () => {
    const f = join(ROOT, "docs/security/KNOWN_LIMITATIONS.md");
    expect(scanDocLinks(readFileSync(f, "utf8"), f)).toEqual([]);
  });
});

describe("independent version surfaces — RELEASING names all four", () => {
  const releasing = readFileSync(join(ROOT, "docs/release/RELEASING.md"), "utf8");
  for (const surface of [
    "cloud/package.json",
    "mobile/package.json",
    "desktop/src-tauri/Cargo.toml",
    "extensions/vscode/package.json",
  ]) {
    test(`RELEASING.md names ${surface}`, () => {
      expect(releasing).toContain(surface);
    });
  }
});

describe("the gates bite — in-memory documents must trip them", () => {
  test("a drifted marker value is a numeric-claim violation", () => {
    const doc = `# doc\nThe ceiling is <!-- XR:TREE-CEILING -->999,000<!-- /XR:TREE-CEILING -->-LOC.\n`;
    const v = scanNumericClaims(doc, join(ROOT, "README-fake.md"), null);
    expect(v.some((x) => x.gate === "numeric-claim" && x.text.includes("999,000"))).toBe(true);
  });

  test("a bare formatted ceiling outside the marker is a numeric-claim violation", () => {
    const v = scanNumericClaims(`holds the tree under a ${comma}-LOC ceiling\n`, join(ROOT, "x.md"), null);
    expect(v.some((x) => x.gate === "numeric-claim")).toBe(true);
  });

  test("history-marked lines are exempt, and benign numbers stay unflagged", () => {
    const doc = `History: raised 135,000 → 136,000. <!-- xr:numeric-history -->\nXR ships 65 skills and 272 ops; Phase 5 extracted 23,376 LOC to satellites.\n`;
    expect(scanNumericClaims(doc, join(ROOT, "x.md"), null)).toEqual([]);
  });

  test("a fabricated relative link is a doc-link violation; pending markers exempt", () => {
    const broken = scanDocLinks("See [ghost](./no-such-file.md).\n", join(ROOT, "docs/x.md"));
    expect(broken.some((x) => x.gate === "doc-link")).toBe(true);
    const pending = scanDocLinks("See [spec](./future-spec.md). <!-- xr:link-pending: lands in v1.2 -->\n", join(ROOT, "docs/x.md"));
    expect(pending).toEqual([]);
  });

  test("fenced code is not scanned as prose", () => {
    const doc = "```\n9,999-LOC example inside a fence\n[ghost](./nope.md)\n```\n";
    expect(scanNumericClaims(doc, join(ROOT, "x.md"), null)).toEqual([]);
    expect(scanDocLinks(doc, join(ROOT, "docs/x.md"))).toEqual([]);
  });
});

describe("--stamp-docs — the stamp keeps every marked surface in sync and is idempotent", () => {
  test("re-stamping a tmp tree tracks TREE_CEILING and the second pass is a no-op", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-stamp-"));
    for (const rel of [
      "README.md",
      "docs/security/KNOWN_LIMITATIONS.md",
      "docs/release/1.1.0/known-limitations.md",
    ]) {
      const abs = join(dir, rel);
      await Bun.$`mkdir -p ${join(abs, "..")}`.quiet();
      writeFileSync(abs, `ceiling <!-- XR:TREE-CEILING -->000,000<!-- /XR:TREE-CEILING -->-LOC\n`);
    }
    const { stampDocs } = await import("../../scripts/size-gate.ts");
    const first = stampDocs(dir);
    expect(first.changed.length).toBe(3);
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain(`>${comma}<`);
    const second = stampDocs(dir);
    expect(second.changed).toEqual([]);
  });
});

describe("XR-LAUNCH-022 — support-matrix test-file counts are single-sourced from platform-parity", () => {
  const SM = join(ROOT, "docs/release/SUPPORT_MATRIX.md");
  const gate = (text: string) => scanNumericClaims(text, SM, null).filter((v) => v.reason.includes("platform:parity:check"));

  test("a hand-typed file or exclusion count in the prose trips the gate", () => {
    expect(gate("| Linux x64 | Tier 1 | full unit suite (239 files), typecheck |\n")).toHaveLength(1);
    // One finding per offending line (the line is fixed as a whole).
    expect(gate("unit suite (234 files; 5 documented exclusions with reasons)\n")).toHaveLength(1);
    expect(gate("5 documented exclusions with reasons\n")).toHaveLength(1);
    expect(gate("runs 1,204 test files\n")).toHaveLength(1);
  });

  test("the generated block, history-marked lines and fenced code are exempt", () => {
    const doc = [
      "<!-- BEGIN GENERATED: journey matrix -->",
      "| x | 94 files |",
      "<!-- END GENERATED: journey matrix -->",
      "Back then it ran 239 files. <!-- xr:numeric-history -->",
      "```",
      "443 test files",
      "```",
      "every test file (count: `bun run platform:parity:check`)",
    ].join("\n");
    expect(gate(doc)).toEqual([]);
  });

  test("the rule is scoped to SUPPORT_MATRIX.md", () => {
    const other = join(ROOT, "docs/release/RELEASING.md");
    expect(scanNumericClaims("ran 239 files\n", other, null).filter((v) => v.reason.includes("platform:parity:check"))).toEqual([]);
  });

  test("the real support matrix passes and points at the parity source", () => {
    const text = readFileSync(SM, "utf8");
    expect(gate(text)).toEqual([]);
    expect(text).toContain("platform:parity:check");
    expect(text).toContain("test/platform/exclusions.json");
    expect(text).not.toContain("first green\nruns land with the Phase-9 merge");
  });
});
