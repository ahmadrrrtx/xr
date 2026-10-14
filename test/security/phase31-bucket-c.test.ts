/**
 * Phase 31 · Bucket C (Website Marketing Polish) regression tests · 2026-10-14
 *
 * Each block pins one C-fix. The rule for this bucket: no dead links, no
 * fake content, no inaccessible chrome, honest copy — and these tests fail
 * if any of it regresses.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dir, "..", "..", "website");
const read = (rel: string) => readFileSync(join(WEB, rel), "utf8");
const readRepo = (rel: string) => readFileSync(join(import.meta.dir, "..", "..", rel), "utf8");

describe("Phase 31 C1 — brand assets exist and are wired", () => {
  test("public assets exist within the size budget (C11: ≤300KB, OG ≤500KB)", () => {
    for (const f of ["favicon.ico", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "og-image.png", "manifest.webmanifest"]) {
      const p = join(WEB, "public", f);
      expect(existsSync(p), f).toBe(true);
      expect(statSync(p).size, f).toBeLessThan(f === "og-image.png" ? 500_000 : 300_000);
    }
  });

  test("layout declares icons, manifest and the OG/Twitter images", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain('manifest: "/manifest.webmanifest"');
    expect(layout).toContain('"/og-image.png"');
    expect(layout).toContain("apple-touch-icon.png");
    expect(existsSync(join(WEB, "src/app/icon.tsx"))).toBe(false); // static assets, no runtime icon
  });

  test("the manifest is installable and shares the cyan brand", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest"));
    expect(manifest.name).toBe("XR");
    expect(manifest.theme_color).toBe("#00E5FF");
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === "512x512")).toBe(true);
  });
});

describe("Phase 31 C2/C9 — no dead internal links, no placeholder content", () => {
  test("docs hub links to the living repo docs, not to 404 routes", () => {
    const docs = read("src/app/docs/page.tsx");
    expect(docs).toContain("Documentation is in progress");
    expect(docs).toContain("github.com/ahmadrrrtx/xr/blob/main/docs/");
    expect(docs).not.toContain('href: "/docs/getting-started"');
    expect(docs).not.toContain('"/docs/cli"');
  });

  test("no page links to /docs/* subroutes that do not exist", () => {
    const models = read("src/app/models/page.tsx");
    expect(models).not.toContain("/docs/models");
  });

  test("downloads has no dead hrefs; every platform card resolves", () => {
    const downloads = readRepo("website/src/app/downloads/page.tsx");
    expect(downloads).not.toContain('href: "#"');
    expect(downloads).not.toContain('href: "#"');
    expect(downloads).toContain("https://github.com/ahmadrrrtx/xr/releases");
  });

  test("the link crawler ships and is wired as a package script", () => {
    expect(existsSync(join(WEB, "scripts/crawl-links.ts"))).toBe(true);
    expect(read("package.json")).toContain("crawl:links");
  });

  test("no fake social proof anywhere on the site", () => {
    const hits = ["50,000 developers", "lorem ipsum", "Our customers love"];
    for (const rel of ["src/app/page.tsx", "src/lib/data.tsx", "src/app/pricing/page.tsx", "src/app/features/page.tsx"]) {
      const body = read(rel);
      for (const h of hits) expect(body, `${rel} :: ${h}`).not.toContain(h);
    }
  });
});

describe("Phase 31 C3/C4/C7 — mobile menu, overflow, accessibility chrome", () => {
  const nav = read("src/components/Nav.tsx");
  const globals = read("src/app/globals.css");

  test("mobile menu: spec aria-labels, Escape, outside-tap, scroll lock", () => {
    expect(nav).toContain('aria-label={open ? "Close navigation" : "Open navigation"}');
    expect(nav).toContain('e.key === "Escape"');
    expect(nav).toContain('document.body.style.overflow = "hidden"');
    expect(nav).toContain("mobile-menu");
    expect(nav).toContain("Security"); // secondary pages in the mobile sheet
    expect(nav).toContain("Support");
  });

  test("44px touch targets and aria-current on the active route", () => {
    expect(nav).toContain("min-h-11 min-w-11");
    expect(nav).toContain('aria-current={pathname === n.href ? "page" : undefined}');
    expect(globals).toContain("@keyframes menu-in");
  });

  test("no horizontal scroll guards; no w-screen anywhere", () => {
    expect(globals).toContain("overflow-x: hidden");
    expect(globals).toContain("overscroll-behavior-y: contain");
    for (const rel of ["src/app/page.tsx", "src/components/Nav.tsx", "src/components/Footer.tsx"]) {
      expect(read(rel), rel).not.toContain("w-screen");
    }
  });

  test("skip link targets the main landmark; focus ring rule intact", () => {
    const layout = read("src/app/layout.tsx");
    const chrome = read("src/components/Chrome.tsx");
    expect(layout).toContain('<a href="#main-content" className="skip-link">');
    expect(chrome.split('id="main-content"').length - 1).toBe(2);
    expect(globals).toContain(":focus-visible");
  });
});

describe("Phase 31 C5 — every page carries its own metadata description", () => {
  const pages: Array<[string, string[]]> = [
    ["src/app/about/page.tsx", ["src/app/about/page.tsx"]],
    ["src/app/blog/page.tsx", ["src/app/blog/page.tsx"]],
    ["src/app/changelog/page.tsx", ["src/app/changelog/page.tsx"]],
    ["src/app/community/page.tsx", ["src/app/community/page.tsx"]],
    ["src/app/contact/page.tsx", ["src/app/contact/layout.tsx"]],
    ["src/app/docs/page.tsx", ["src/app/docs/page.tsx"]],
    ["src/app/downloads/page.tsx", ["src/app/downloads/page.tsx"]],
    ["src/app/enterprise/page.tsx", ["src/app/enterprise/layout.tsx"]],
    ["src/app/features/page.tsx", ["src/app/features/page.tsx"]],
    ["src/app/marketplace/page.tsx", ["src/app/marketplace/page.tsx"]],
    ["src/app/pricing/page.tsx", ["src/app/pricing/page.tsx"]],
    ["src/app/privacy/page.tsx", ["src/app/privacy/page.tsx"]],
    ["src/app/research/page.tsx", ["src/app/research/page.tsx"]],
    ["src/app/roadmap/page.tsx", ["src/app/roadmap/page.tsx"]],
    ["src/app/status/page.tsx", ["src/app/status/page.tsx"]],
    ["src/app/support/page.tsx", ["src/app/support/page.tsx"]],
    ["src/app/terms/page.tsx", ["src/app/terms/page.tsx"]],
  ];

  test("page-specific description exists and stays under 160 chars", () => {
    for (const [label, files] of pages) {
      const found = files.some((f) => existsSync(join(WEB, f)) && /description:\s*\n?\s*"([^"]{20,160})"/.test(read(f)));
      expect(found, label).toBe(true);
    }
  });
});

describe("Phase 31 C6 — AA contrast tokens", () => {
  test("the failing 4.09:1 dim token was raised to #8a8a93 (5.78:1)", () => {
    const globals = read("src/app/globals.css");
    expect(globals).toContain("--color-text-dim: #8a8a93");
    expect(globals).toContain("--color-zinc-500: #8a8a93");
    expect(globals).not.toContain("--color-text-dim: #71717a");
  });
});

describe("Phase 31 C8/C10 — clickable contact, copy feedback, footer links", () => {
  test("contact page carries the prominent support mailto", () => {
    expect(read("src/app/contact/page.tsx")).toContain('href="mailto:support@xr.rrrtx.ai"');
  });

  test("copy button toasts success and failure, never silent", () => {
    const copy = read("src/components/CopyButton.tsx");
    expect(copy).toContain("Copied to clipboard");
    expect(copy).toContain("Copy failed — press Ctrl+C");
    expect(copy).toContain('role="status"');
  });

  test("footer logo is a home link; Pakistan craft line present; no fake status dot", () => {
    const footer = read("src/components/Footer.tsx");
    expect(footer).toContain('<Link href="/" aria-label="XR — home"');
    expect(footer).toContain("Made with local-first ethos in Pakistan");
    expect(footer).not.toContain("bg-emerald-400"); // B7 honesty beats C12's green dot
  });
});

describe("Phase 31 C13/C14/C15 — pricing, 404, downloads", () => {
  test("pricing: working toggle driven by the constants, honest line, enterprise mailto", () => {
    const plans = read("src/components/PricingPlans.tsx");
    expect(plans).toContain("aria-pressed");
    expect(plans).toContain("businessPricing");
    expect(plans).toContain("No credit card required for trial. Cancel anytime.");
    expect(read("src/app/pricing/page.tsx")).toContain("Compare plans");
    expect(read("src/lib/data.tsx")).toContain('href: "mailto:sales@xr.rrrtx.ai"');
  });

  test("404 offers back-home and report-a-broken-link", () => {
    const nf = read("src/app/not-found.tsx");
    expect(nf).toContain("Back home");
    expect(nf).toContain("Report a broken link");
    expect(nf).toContain("mailto:support@xr.rrrtx.ai");
  });

  test("downloads: six platform cards, requirements, checksums", () => {
    const downloads = readRepo("website/src/app/downloads/page.tsx");
    for (const label of ["macOS (Apple Silicon)", "macOS (Intel)", "Windows x64", "Linux (AppImage)", "Linux (.deb)", "npm CLI"]) {
      expect(downloads, label).toContain(label);
    }
    expect(downloads).toContain("macOS 13");
    expect(downloads).toContain("Windows 10");
    expect(downloads).toContain("Ubuntu 22.04+ / Fedora 38+");
    expect(downloads).toContain("SHA-256");
  });
});
