/**
 * Fix-program Phase 1.4 — P2-10 + P2-9 regression guard.
 *
 * Static-source assertions only (node:fs, no network, no rendering): the two
 * new public pages exist and tell the truth, the marketing DashboardPreview
 * labels its sample numbers, and the footer links resolve. The imprint
 * values are extracted from the Phase-1.1 sources themselves (privacy page +
 * footer) and asserted cross-file — so if Phase 1.1's identity ever changes,
 * this test forces the imprint to be re-synced instead of quietly drifting.
 *
 * House references: test/a11y/static.test.ts (reads source, pins markup),
 * test/ux/sus.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const W = (rel: string) => join(ROOT, "website", rel);
const read = (abs: string) => readFileSync(abs, "utf8");

const A11Y_PAGE = W("src/app/accessibility/page.tsx");
const IMPRINT_PAGE = W("src/app/imprint/page.tsx");
const PRIVACY_PAGE = W("src/app/legal/privacy/page.tsx");
const FOOTER = W("src/components/Footer.tsx");
const PREVIEW = W("src/components/DashboardPreview.tsx");
const SITE = W("src/lib/site.ts");

/**
 * Over-claiming patterns applied to the two NEW pages. These are the
 * claim-lint supervised terms in context — Art. X / CONFORMANCE.md honesty
 * (automation can verify, it cannot certify), and the WCAG meaning of
 * "conforms" (no claim is made without a human pass).
 */
export const FORBIDDEN_CLAIM_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /fully (compliant|conforms|accessible)/i, reason: "\"fully X\" is a conformance claim; the human pass is pending (CONFORMANCE.md register)" },
  { pattern: /WCAG[^.]{0,20}\bcertified\b/i, reason: "WCAG has no certification program; \"certified\" is a supervised term" },
  { pattern: /guaranteed[^.]{0,30}(accessib|WCAG)/i, reason: "\"guaranteed accessible\" fabricates a guarantee no automated gate can give" },
  { pattern: /zero accessibility (issues|violations) (anywhere|site-?wide)/i, reason: "the axe evidence is scoped to Control Center surfaces, not site-wide" },
  { pattern: /\bcomplete conformance\b/i, reason: "\"complete\" is a supervised term; full conformance awaits the human pass" },
];

/** Extract a value from one of the Phase-1.1 sources and fail loudly if the source drifted. */
function extract(source: string, re: RegExp, label: string, fromFile: string): string {
  const m = source.match(re);
  if (!m) throw new Error(`${label} not found in ${fromFile} — Phase 1.1 source drifted; re-derive before re-testing`);
  return m[1] ?? m[0];
}

describe("routes exist and are real pages (P2-10)", () => {
  for (const [name, abs] of [["accessibility", A11Y_PAGE], ["imprint", IMPRINT_PAGE]] as const) {
    test(`/${name} page.tsx exists, exports metadata and a default page component`, () => {
      expect(existsSync(abs)).toBe(true);
      const src = read(abs);
      expect(src).toContain("export const metadata");
      expect(src).toContain("export default function");
    });
  }

  test("accessibility page states the verified/pending register and the reporting route", () => {
    const src = read(A11Y_PAGE);
    expect(src).toContain("automated-verified"); // CONFORMANCE.md status register, first half
    expect(src).toContain("pending"); // manual passes must read as pending, never done
    expect(src).toContain("support@xr.rrrtx.ai"); // the site's existing support contact, no invented mailbox
  });

  test("imprint page reuses the Phase-1.1 identity values verbatim (cross-file)", () => {
    const privacy = read(PRIVACY_PAGE);
    const footer = read(FOOTER);
    const imprint = read(IMPRINT_PAGE);

    // Extract from the two Phase-1.1 files; do not retype here.
    const publisher = extract(privacy, /Published by (Muhammad Ahmad)/, "publisher name", "privacy page");
    const entity = extract(privacy, /Published by Muhammad Ahmad · (XR RRRTX Labs)/, "entity name", "privacy page");
    const office = extract(privacy, /(Remote-first · Chiniot, Punjab, Pakistan)/, "registered office", "privacy page");
    const officer = extract(privacy, /Grievance officer: (Muhammad Ahmad), (ahmadrrrtx333@gmail\.com)/, "grievance officer", "privacy page");
    const hours = extract(privacy, /available (24 hr)/, "grievance hours", "privacy page");

    // The footer must agree on office + entity (STOP rule: catch internal inconsistency).
    expect(footer).toContain(office);
    expect(footer).toContain(entity);

    for (const [label, value] of [
      ["publisher", publisher],
      ["entity", entity],
      ["registered office", office],
      ["grievance officer", officer],
      ["grievance email", "ahmadrrrtx333@gmail.com"],
      ["grievance hours", hours],
      ["support contact", "support@xr.rrrtx.ai"],
      ["privacy contact", "privacy@xr.rrrtx.ai"],
    ] as const) {
      expect(imprint, `imprint must reuse ${label} exactly as published`).toContain(value);
    }
  });

  test("imprint links the three legal documents", () => {
    const src = read(IMPRINT_PAGE);
    for (const href of ["/legal/privacy", "/legal/terms", "/legal/notices"]) {
      expect(src).toContain(`href="${href}"`);
    }
  });
});

describe("no over-claiming on the new pages (Art. X)", () => {
  for (const [name, abs] of [["accessibility", A11Y_PAGE], ["imprint", IMPRINT_PAGE]] as const) {
    for (const { pattern, reason } of FORBIDDEN_CLAIM_PATTERNS) {
      test(`/${name} page: ${pattern} is absent — ${reason}`, () => {
        expect(read(abs)).not.toMatch(pattern);
      });
    }
  }
});

describe("demo labelling (P2-9)", () => {
  const src = read(PREVIEW);

  test("a visible sample-data label exists", () => {
    expect(src).toContain("Sample data");
  });

  test('the standalone "Live" pill is gone', () => {
    expect(src).not.toMatch(/>\s*Live\s*</);
  });

  test("the aria-label tells assistive tech the same truth", () => {
    expect(src).toContain('aria-label="XR dashboard preview — sample data, not a live system"');
  });

  test("the fix is labelling, not deletion: the three illustration numbers remain", () => {
    for (const lit of ['value="1,284"', 'value="48.2M"', 'value="98.7%"']) {
      expect(src).toContain(lit);
    }
  });
});

describe("footer wiring (P2-10)", () => {
  const src = read(SITE);
  const footerLegal = src.slice(src.indexOf("legal:"));

  test.each([
    ['{ label: "Accessibility", href: "/accessibility" }', "/accessibility"],
    ['{ label: "Imprint", href: "/imprint" }', "/imprint"],
  ])("footer.legal contains %s and the route dir exists", (entry, href) => {
    expect(footerLegal).toContain(entry);
    expect(existsSync(W(`src/app${href}`))).toBe(true);
  });
});
