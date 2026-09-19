/**
 * Phase 1 · design system v3 (D-V3-1): the type identity ships inside the
 * package. These tests prove the gate on the REAL desktop tree and prove its
 * negative branch on fixtures — a check that cannot fail is decoration.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkFonts } from "../../scripts/desktop-fonts-check.ts";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "xr-fonts-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

describe("desktop fonts check · the type identity is bundled", () => {
  test("the real desktop tree passes: no remote fonts, every bundled file pinned, no Inter", () => {
    const r = checkFonts();
    expect(r.violations).toEqual([]);
    expect(r.pinned).toBeGreaterThanOrEqual(11); // 2 display + 7 body + 2 code
  });

  test("a Google Fonts import is a FONT-URL violation", () => {
    const root = fixture({ "src/styles/tokens.css": '@import url("https://fonts.googleapis.com/css2?family=Inter");\n:root{--xr-font-sans:"IBM Plex Sans"}' });
    try {
      const rules = checkFonts(root).violations.map((v) => v.rule);
      expect(rules).toContain("FONT-URL");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a remote url() inside @font-face is caught even without a known CDN host", () => {
    const root = fixture({ "src/styles/fonts.css": '@font-face {\n  font-family: "X";\n  src: url("https://example.com/x.woff2") format("woff2");\n}\n' });
    try {
      expect(checkFonts(root).violations.map((v) => v.rule)).toContain("FONT-URL");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fonts.css pointing at a file that is not in the package is FONT-MISSING", () => {
    const root = fixture({ "src/styles/fonts.css": '@font-face { font-family: "X"; src: url("../assets/fonts/nope.woff2") format("woff2"); }\n' });
    try {
      expect(checkFonts(root).violations.map((v) => v.rule)).toContain("FONT-MISSING");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an unpinned or altered woff2 is FONT-UNPINNED", () => {
    const root = fixture({
      "src/assets/fonts/a.woff2": "wOF2-bytes-a",
      "src/assets/fonts/b.woff2": "wOF2-bytes-b",
      "src/assets/fonts/SHA256SUMS": "0000000000000000000000000000000000000000000000000000000000000000  a.woff2\n",
    });
    try {
      const v = checkFonts(root).violations.filter((x) => x.rule === "FONT-UNPINNED");
      expect(v.map((x) => x.text).sort()).toEqual(["a.woff2", "b.woff2"]); // a: hash differs · b: not listed
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("naming Inter in a --xr-font token is FONT-IDENTITY", () => {
    const root = fixture({ "src/styles/tokens.css": ':root {\n  --xr-font-sans: "Inter", system-ui, sans-serif;\n}\n' });
    try {
      expect(checkFonts(root).violations.map((v) => v.rule)).toEqual(["FONT-IDENTITY"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
