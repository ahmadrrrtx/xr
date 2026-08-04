/**
 * XR Phase 9 · T6 (Part 10) — the website's downloads page is honest and
 * manifest-driven (audit finding P11): no dead cards, no fictional
 * integrations, no false runtime requirements, Beta labeled, verification
 * linked. Source-level effect assertions; the website build job proves it
 * compiles, claim-lint governs its claims.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const PAGE = readFileSync(join(ROOT, "website", "src", "app", "downloads", "page.tsx"), "utf8");

describe("Phase 9 · honest downloads page", () => {
  test("channels come from the manifest-stamped distribution module", () => {
    expect(PAGE).toContain("@/lib/distribution");
    expect(PAGE).toContain("XR_DISTRIBUTION");
    expect(PAGE).toContain("d.channels.map"); // rendered from the manifest, not literals
  });

  test("no dead cards and no placeholder hrefs remain", () => {
    expect(PAGE).not.toContain('href: "#"');
    expect(PAGE).not.toContain('href="#"');
  });

  test("fictional editor integrations are gone (they never shipped)", () => {
    for (const name of ["VS Code", "Neovim", "JetBrains", "Zed", "Cursor"]) {
      expect(PAGE).not.toContain(name);
    }
  });

  test("false runtime claim removed (XR is Bun, not Node 20+)", () => {
    expect(PAGE).not.toMatch(/Node 20/);
  });

  test("Beta label + verification + known limitations are on the page", () => {
    expect(PAGE).toContain("stabilityLabel");
    expect(PAGE).toContain("verifyingUrl");
    expect(PAGE).toContain("knownLimitationsUrl");
    expect(PAGE).toContain("cosign verify-blob");
  });

  test("the previous unverified size claim is gone", () => {
    expect(PAGE).not.toMatch(/40MB/);
  });

  test("website sources carry no fictional-channel literals anywhere else", () => {
    // scan the whole website source tree for the old fictional integrations
    const offenders: string[] = [];
    function walk(dir: string): void {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) {
          if (e === "node_modules" || e.startsWith(".")) continue;
          walk(p);
        } else if (/\.(ts|tsx)$/.test(e)) {
          const src = readFileSync(p, "utf8").replaceAll("JetBrains_Mono", ""); // the font, not the IDE
          if (/Neovim|JetBrains|WebStorm/.test(src)) offenders.push(p);
        }
      }
    }
    walk(join(ROOT, "website", "src"));
    expect(offenders).toEqual([]);
  });
});
