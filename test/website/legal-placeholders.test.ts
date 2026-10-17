import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanPlaceholders } from "../../scripts/placeholder-lint.ts";

/**
 * Phase 1.1 — P0-1 regression guard (XR_FINAL_MASTER_AUDIT §5).
 *
 * The live privacy policy and every page footer shipped unfinished legal
 * placeholders (`[TO FILL: …]`) — the controller identity GDPR Art. 13 needs
 * and the named grievance officer India DPDP needs. These tests pin the fix:
 * no markers on the public surface, the real identity actually landed, and
 * the placeholder-lint gate itself provably fails on an injected marker.
 */

const REPO_ROOT = join(import.meta.dir, "..", "..");
const WEBSITE_SRC = join(REPO_ROOT, "website", "src");
const PRIVACY_PAGE = join(WEBSITE_SRC, "app", "legal", "privacy", "page.tsx");
const FOOTER = join(WEBSITE_SRC, "components", "Footer.tsx");

// Owner-supplied legal identity for Phase 1.1 (public record — not secrets).
const IDENTITY = {
  entity: "RRRTX Labs",
  office: "Remote-first · Chiniot, Punjab, Pakistan",
  officerName: "Muhammad Ahmad",
  officerEmail: "ahmadrrrtx333@gmail.com",
  officerHours: "24 hr",
} as const;

describe("P0-1 · no placeholder markers on the public surface", () => {
  test("website/src contains no TO FILL or [[bracketed]] markers", () => {
    const { findings, scanned } = scanPlaceholders(WEBSITE_SRC);
    expect(scanned).toBeGreaterThan(0);
    expect(findings).toEqual([]);
  });
});

describe("P0-1 · the legal identity landed (content, not just absence of markers)", () => {
  const privacy = readFileSync(PRIVACY_PAGE, "utf8");
  const footer = readFileSync(FOOTER, "utf8");

  test("privacy page carries the entity, office and the named DPDP grievance officer", () => {
    expect(privacy).toContain(IDENTITY.entity);
    expect(privacy).toContain(IDENTITY.office);
    expect(privacy).toContain(IDENTITY.officerName);
    expect(privacy).toContain(IDENTITY.officerEmail);
    expect(privacy).toContain(IDENTITY.officerHours);
    for (const value of Object.values(IDENTITY)) expect(value.length).toBeGreaterThan(0);
  });

  test("footer carries the entity and the registered-office line", () => {
    expect(footer).toContain(IDENTITY.entity);
    expect(footer).toContain(IDENTITY.office);
  });

  test("neither public file contains a placeholder substring", () => {
    for (const source of [privacy, footer]) {
      expect(source.includes("TO FILL")).toBe(false);
      expect(source.includes("[[")).toBe(false);
    }
  });
});

describe("P0-1 · the placeholder-lint gate bites", () => {
  test("scanPlaceholders reports an injected marker in a temp tree (website/ untouched)", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "placeholder-lint-"));
    try {
      mkdirSync(join(sandbox, "components"), { recursive: true });
      writeFileSync(join(sandbox, "components", "Footer.tsx"), "// [TO FILL: x]\n");
      writeFileSync(join(sandbox, "page.tsx"), "// owner: [[name]]\n");
      writeFileSync(join(sandbox, "clean.ts"), "export const ok = true;\n");

      const { findings, scanned } = scanPlaceholders(sandbox);
      expect(scanned).toBe(3);
      expect(findings.length).toBeGreaterThanOrEqual(2);
      expect(findings.some((f) => f.file.endsWith("Footer.tsx") && f.line === 1)).toBe(true);
      expect(findings.some((f) => f.marker.includes("[[…]]"))).toBe(true);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test("scanPlaceholders passes a clean temp tree", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "placeholder-lint-clean-"));
    try {
      writeFileSync(join(sandbox, "ok.tsx"), "export const ok = true;\n");
      const { findings, scanned } = scanPlaceholders(sandbox);
      expect(scanned).toBe(1);
      expect(findings).toEqual([]);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
