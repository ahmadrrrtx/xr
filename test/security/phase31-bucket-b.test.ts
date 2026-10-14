/**
 * Phase 31 · Bucket B (Legal) — regression tripwires.
 *
 * Legal pages are prose, so there is little to execute; what can be pinned
 * down is pinned: the pages exist, the mandated clauses are present, the
 * honesty edits (no fabricated uptime, no fake roles, no invented ratings,
 * no trackers) cannot silently regress, and the consent banner's
 * acknowledgement key matches the cookie policy's declaration. Rendering
 * itself is proven by the website production build (CI `website` job).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const exists = (rel: string) => existsSync(join(ROOT, rel));

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry)) yield full;
  }
}

describe("Phase 31 · B1–B4 legal pages exist with their mandated content", () => {
  test("privacy: local collects nothing, rights route, grievance placeholder", () => {
    const privacy = read("website/src/app/legal/privacy/page.tsx");
    expect(privacy).toContain("XR Personal is 100% local. We collect nothing.");
    expect(privacy).toContain("We do not sell data. No ads. No third-party trackers.");
    expect(privacy).toContain("Data Rights Request");
    expect(privacy).toContain("Grievance officer: [TO FILL:");
    expect(privacy).toContain("Standard Contractual Clauses");
    // The legacy /privacy URL renders the same document.
    expect(read("website/src/app/privacy/page.tsx")).toContain("../legal/privacy/page");
  });

  test("terms: age clause (B8), refund link, DMCA, indemnification", () => {
    const terms = read("website/src/app/legal/terms/page.tsx");
    expect(terms).toContain("at least 13");
    expect(terms).toContain("at least 18");
    expect(terms).toContain("DPDP");
    expect(terms).toContain('href="/refund"');
    expect(terms).toContain('href="/legal/dmca"');
    expect(terms).toContain("Indemnification (Business)");
  });

  test("cookies: the real inventory, and what is never used", () => {
    const cookies = read("website/src/app/cookies/page.tsx");
    expect(cookies).toContain("xr_session");
    expect(cookies).toContain("__stripe_*");
    expect(cookies).toContain("xr_cookie_ack");
    expect(cookies).toContain("not</strong> use analytics cookies");
  });

  test("refund: 14-day guarantee and how to claim it", () => {
    const refund = read("website/src/app/refund/page.tsx");
    expect(refund).toContain("14-day money-back");
    expect(refund).toContain("first charge");
    expect(refund).toContain("billing@xr.rrrtx.ai");
    expect(refund).toContain("7 business days");
  });

  test("dmca + notices pages exist (B10/B11)", () => {
    const dmca = read("website/src/app/legal/dmca/page.tsx");
    expect(dmca).toContain("Designated Agent: to be registered with the US Copyright Office at launch");
    expect(dmca).toContain("dmca@xr.rrrtx.ai");
    expect(dmca).toContain("counter-notice");
    const notices = read("website/src/app/legal/notices/page.tsx");
    for (const name of ["Inter", "JetBrains Mono", "Orbitron", "Lucide", "Shiki"]) {
      expect(notices).toContain(name);
    }
    expect(exists("website/ATTRIBUTION.md")).toBe(true);
    expect(read("website/ATTRIBUTION.md")).toContain("SIL Open Font License 1.1");
  });

  test("B9: email compliance doc", () => {
    const email = read("docs/business/EMAIL.md");
    expect(email).toContain("Physical postal address");
    expect(email).toContain("One-click unsubscribe");
    expect(email).toContain("honoured within 10 business");
    expect(email).toContain("No purchased lists");
  });
});

describe("Phase 31 · B5 consent banner", () => {
  test("banner acknowledges via xr_cookie_ack and is mounted in Chrome", () => {
    const banner = read("website/src/components/CookieBanner.tsx");
    expect(banner).toContain('localStorage.getItem("xr_cookie_ack")');
    expect(banner).toContain('localStorage.setItem("xr_cookie_ack", "1")');
    expect(banner).toContain("Accept &amp; continue");
    expect(banner).toContain('href="/cookies"');
    expect(banner).toContain("safe-area-inset-bottom");
    expect(read("website/src/components/Chrome.tsx")).toContain("<CookieBanner />");
  });
});

describe("Phase 31 · B6/B7 honesty surface", () => {
  test("footer: dynamic year, real X link, mailto, legal links, no fake status", () => {
    const footer = read("website/src/components/Footer.tsx");
    expect(footer).toContain("https://x.com/ahmadrrrtx");
    expect(footer).toContain("new Date().getFullYear()");
    expect(footer).toContain("[TO FILL: Registered Entity Name]");
    expect(footer).toContain("mailto:support@xr.rrrtx.ai");
    expect(footer).not.toContain("All systems normal");
    const site = read("website/src/lib/site.ts");
    expect(site).toContain('{ label: "Cookies", href: "/cookies" }');
    expect(site).toContain('{ label: "Refunds", href: "/refund" }');
    expect(site).toContain('{ label: "Notices", href: "/legal/notices" }');
  });

  test("status page performs no monitoring it does not have", () => {
    const status = read("website/src/app/status/page.tsx");
    expect(status).not.toContain("99.9");
    expect(status).not.toContain("Operational");
    expect(status).toContain("Realtime uptime monitoring is coming after launch");
    expect(status).toContain("github.com/ahmadrrrtx/xr/issues");
  });

  test("careers lists no invented openings or benefits", () => {
    const careers = read("website/src/app/careers/page.tsx");
    expect(careers).toContain("No open roles right now");
    expect(careers).not.toContain("Unlimited PTO");
    expect(careers).not.toContain("Senior Software Engineer, Runtime");
  });

  test("marketplace shows an em dash until real reviews exist", () => {
    const browser = read("website/src/components/MarketplaceBrowser.tsx");
    expect(browser).toContain("item.reviews > 0");
    expect(browser).toContain("—");
  });

  test("desktop Settings → About points at the website legal pages", () => {
    const about = read("desktop/src/screens/Settings/tabs/AboutTab.tsx");
    expect(about).toContain("/legal/privacy");
    expect(about).toContain("/legal/terms");
    expect(about).not.toContain("#privacy");
  });
});

describe("Phase 31 · B7 acceptance — no tracking scripts anywhere on the site", () => {
  test("zero tracker domains in website source", () => {
    const trackerDomains = [
      "google-analytics.com",
      "googletagmanager.com",
      "static.hotjar.com",
      "fullstory.com",
      "posthog.com",
      "plausible.io",
      "cdn.segment.com",
    ];
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "website/src"))) {
      const text = readFileSync(file, "utf8");
      for (const domain of trackerDomains) {
        if (text.includes(domain)) offenders.push(`${file}: ${domain}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
