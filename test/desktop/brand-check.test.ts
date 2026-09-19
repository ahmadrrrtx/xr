/**
 * Phase 1 · D-05 / D-V3-4: brand geometry ships only as the official renders,
 * every brand image is registered with its hash, and placements go through
 * components/Brand.tsx. Real-tree pass + fixture-proven negative branches.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REGISTRY_PATH, buildRegistry, checkBrand } from "../../scripts/desktop-brand-check.ts";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "xr-brand-"));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

describe("desktop brand check · official renders only", () => {
  test("the real tree passes and registers every brand image (logo, avatar poses, hero, icons)", () => {
    const r = checkBrand();
    expect(r.violations).toEqual([]);
    expect(r.registered).toBeGreaterThanOrEqual(12);
    const files = buildRegistry().files.map((f) => f.file);
    for (const must of [
      "desktop/src/assets/xr-logo.png",
      "desktop/src/assets/xr-avatar.png",
      "desktop/src/assets/xr-avatar-side.webp",
      "desktop/src/assets/xr-avatar-side-2.webp",
      "desktop/src/assets/xr-hero.webp",
      "desktop/src-tauri/icons/icon.ico",
    ]) {
      expect(files).toContain(must);
    }
  });

  test("a vector brand file is BRAND-SVG (re-drawn geometry by definition)", () => {
    const root = fixture({ "assets/logo.svg": "<svg/>", [REGISTRY_PATH]: JSON.stringify({ files: [] }) });
    try {
      expect(checkBrand(root).violations.map((v) => v.rule)).toEqual(["BRAND-SVG"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an unregistered image, a changed image and a vanished image are each named", () => {
    const root = fixture({
      "desktop/src/assets/xr-new.png": "PNG-new",
      "desktop/src/assets/xr-logo.png": "PNG-changed",
    });
    // Register xr-logo with a stale hash and a file that no longer exists.
    writeFileSync(
      join(root, REGISTRY_PATH),
      JSON.stringify({
        files: [
          { file: "desktop/src/assets/xr-logo.png", sha256: "0".repeat(64), source: "x", role: "x" },
          { file: "desktop/src/assets/xr-gone.png", sha256: "0".repeat(64), source: "x", role: "x" },
        ],
      }),
    );
    try {
      const v = checkBrand(root).violations;
      expect(v.find((x) => x.file === "desktop/src/assets/xr-new.png")?.rule).toBe("BRAND-UNLISTED");
      expect(v.find((x) => x.file === "desktop/src/assets/xr-logo.png")?.rule).toBe("BRAND-HASH");
      expect(v.find((x) => x.file === "desktop/src/assets/xr-gone.png")?.rule).toBe("BRAND-MISSING");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("importing a brand image outside Brand.tsx is BRAND-IMPORT; inside it is fine", () => {
    const root = fixture({
      "desktop/src/components/Brand.tsx": 'import logo from "../assets/xr-logo.png";\nexport const L = logo;\n',
      "desktop/src/screens/Home.tsx": 'import avatar from "../assets/xr-avatar.png";\nexport const A = avatar;\n',
      [REGISTRY_PATH]: JSON.stringify({ files: [] }),
    });
    try {
      const v = checkBrand(root).violations;
      expect(v.map((x) => x.rule)).toEqual(["BRAND-IMPORT"]);
      expect(v[0].file).toBe("desktop/src/screens/Home.tsx");
      expect(v[0].line).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("--write output is stable: rebuilding the registry from the real tree changes nothing", () => {
    const fresh = buildRegistry();
    const committed = JSON.parse(require("node:fs").readFileSync(join(import.meta.dir, "../../", REGISTRY_PATH), "utf8")) as typeof fresh;
    expect(fresh.files).toEqual(committed.files);
  });
});
