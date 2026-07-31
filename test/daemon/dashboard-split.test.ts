/**
 * XR Phase 2 · T7 — the dashboard split is behaviour-preserving.
 *
 * `src/daemon/dashboard.ts` was 3 619 lines: one function returning one
 * template literal containing the stylesheet, the markup and the entire client
 * application. It is now a 48-line entry point over three focused modules.
 *
 * A refactor of a 3 600-line template is only safe if the OUTPUT is provably
 * unchanged, so this test pins the rendered document by SHA-256 against the
 * value measured on the pre-split implementation. If a future edit changes the
 * page, this fails loudly and the author must update the hash deliberately —
 * which is the point.
 */

import { describe, expect, test } from "bun:test";
import {
  dashboardHtml,
  DASHBOARD_CSS,
  DASHBOARD_SCRIPT,
  DASHBOARD_PAGE,
} from "../../src/daemon/dashboard.ts";

/**
 * Recorded from the pre-split `dashboard.ts` at commit 0dd6be9 with
 * `dashboardHtml("TESTTOKEN")`.
 */
const PRE_SPLIT_SHA256 = "2275fc9102684385cbe86c9ec6052cd1b3bd860bac22cdf682f5f424a963e741";
const PRE_SPLIT_LENGTH = 667410;

function sha256(s: string): string {
  return new Bun.CryptoHasher("sha256").update(s).digest("hex");
}

describe("T7 — dashboard split preserves behaviour exactly", () => {
  test("the rendered document is BYTE-IDENTICAL to the pre-split output", () => {
    const html = dashboardHtml("TESTTOKEN");
    expect(html.length).toBe(PRE_SPLIT_LENGTH);
    expect(sha256(html)).toBe(PRE_SPLIT_SHA256);
  });

  test("token substitution still works", () => {
    const html = dashboardHtml("secret-token-abc");
    expect(html).toContain("secret-token-abc");
    expect(html).not.toContain("__TOKEN__");
  });

  test("version placeholders are substituted", () => {
    const html = dashboardHtml("t");
    for (const placeholder of [
      "__XR_VERSION__",
      "__XR_CORE_VERSION__",
      "__XR_PKG_NAME__",
      "__XR_REPO__",
      "__XR_HOMEPAGE__",
      "__XR_LOGO__",
      "__XR_AVATAR__",
    ]) {
      expect(html).not.toContain(placeholder);
    }
  });

  test("the document is well-formed: one style block, one script block", () => {
    const html = dashboardHtml("t");
    expect(html.split("<style>").length - 1).toBe(1);
    expect(html.split("</style>").length - 1).toBe(1);
    expect(html.split("<script>").length - 1).toBe(1);
    expect(html.split("</script>").length - 1).toBe(1);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });
});

describe("T7 — the fragments are separately addressable", () => {
  test("each fragment is non-trivial", () => {
    expect(DASHBOARD_CSS.length).toBeGreaterThan(5_000);
    expect(DASHBOARD_SCRIPT.length).toBeGreaterThan(20_000);
    expect(DASHBOARD_PAGE.length).toBeGreaterThan(100_000);
  });

  test("the CSS fragment contains only styles, not markup or script", () => {
    expect(DASHBOARD_CSS).not.toContain("<script");
    expect(DASHBOARD_CSS).not.toContain("<!DOCTYPE");
    expect(DASHBOARD_CSS).toContain("--"); // custom properties
  });

  test("the script fragment contains client logic, not a style block", () => {
    expect(DASHBOARD_SCRIPT).not.toContain("<style>");
    expect(DASHBOARD_SCRIPT).toContain("function ");
  });

  test("the composed page embeds both fragments verbatim", () => {
    expect(DASHBOARD_PAGE).toContain(DASHBOARD_CSS);
    expect(DASHBOARD_PAGE).toContain(DASHBOARD_SCRIPT);
  });
});

describe("T7 — the entry module stays thin", () => {
  test("dashboard.ts is under the size threshold", async () => {
    const src = await Bun.file(
      new URL("../../src/daemon/dashboard.ts", import.meta.url),
    ).text();
    expect(src.split("\n").length).toBeLessThan(800);
  });
});
