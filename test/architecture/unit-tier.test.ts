/**
 * XR Phase 8 · T5 — unit-tier curation guard.
 *
 * The unit tier is a sacred contract with contributors: fast enough to run on
 * every save (< 5 s), comprehensive enough to catch the mistakes that cost
 * review rounds. These tests guard the TIER ITSELF — manifest entries exist,
 * nothing that requires a browser/installer/network/snail pacing sneaks in,
 * and the package.json wiring stays intact. Runtime proof is the script's own
 * budget gate (`scripts/unit-tier.ts` exits 1 over budget), which CI runs.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UNIT_TIER } from "../../scripts/unit-tier.ts";

const ROOT = join(import.meta.dir, "../..");

describe("T5 — unit tier curation", () => {
  test("every manifest entry exists on disk (stale curation fails loudly)", () => {
    for (const file of UNIT_TIER) {
      expect(existsSync(join(ROOT, file))).toBe(true);
    }
  });

  test("the tier is substantive (cannot quietly shrink to a token check)", () => {
    expect(UNIT_TIER.length).toBeGreaterThanOrEqual(15);
    expect(new Set(UNIT_TIER).size).toBe(UNIT_TIER.length); // no duplicates farming the count
  });

  test("unit-tier files contain no slow-class dependencies (static scan)", () => {
    const forbidden = [
      { marker: "from \"playwright\"", why: "browser launches belong in test/a11y/browser-axe" },
      { marker: "chromium", why: "browser launches belong in test/a11y/browser-axe" },
      { marker: "first-task-attempt", why: "survey workers spawn installers" },
      { marker: "golden-path.ts", why: "the golden path is a full-journey subprocess" },
      { marker: "Docker", why: "container builds are nightly-tier" },
    ];
    for (const file of UNIT_TIER) {
      const src = readFileSync(join(ROOT, file), "utf8");
      for (const { marker, why } of forbidden) {
        expect(src.includes(marker), `${file} contains "${marker}" — ${why}`).toBe(false);
      }
    }
  });

  test("the tier covers the gates a first PR can break (architecture, API, trust, UX)", () => {
    const joined = UNIT_TIER.join("\n");
    expect(joined).toContain("test/architecture/");
    expect(joined).toContain("test/api/");
    expect(joined).toContain("test/phase0/");
    expect(joined).toContain("test/a11y/");
    expect(joined).toContain("test/ux/");
    expect(joined).toContain("test/core/");
  });

  test("package.json wires `bun run unit-tier` to the script", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["unit-tier"]).toBe("bun run scripts/unit-tier.ts");
  });

  test("the script documents its 5s budget and CI headroom", () => {
    const script = readFileSync(join(ROOT, "scripts/unit-tier.ts"), "utf8");
    expect(script).toContain("5000");
    expect(script).toContain("move slow tests back to the full suite instead of raising the budget");
  });
});
