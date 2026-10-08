/**
 * Phase 20 — Skills Store pure core (desktop/src/skills/core.ts):
 * category mapping, permission chips, trust vocabulary, card state, brand
 * monograms, search. Relative imports — same convention as the other desktop
 * tests (no path alias).
 */
import { describe, expect, test } from "bun:test";

import {
  brandFor,
  cardState,
  categoryMatches,
  CATEGORY_DEFS,
  dangerSummary,
  filterByCategory,
  formatCount,
  hasDangerousPermissions,
  matchesQuery,
  permissionChip,
  trustOf,
  type SkillRecord,
} from "../../desktop/src/skills/core.ts";

function rec(over: Partial<SkillRecord> = {}): SkillRecord {
  return {
    id: "pdf_reader",
    name: "PDF Reader",
    version: "1.0.0",
    description: "Read and extract text from PDF documents.",
    longDescription: null,
    categories: ["productivity"],
    tags: ["pdf", "documents"],
    publisher: "xr-official",
    verification: "official",
    signed: true,
    signingKeyId: null,
    homepage: null,
    repository: null,
    kind: "xr-manifest",
    skillType: "executable",
    source: "bundled",
    enabled: true,
    installed: true,
    health: "healthy",
    permissions: [{ scope: "fs:read", reason: "Reads the PDF", optional: false, dangerous: false, paths: [], domains: [] }],
    dependencies: [],
    commands: [],
    slashCommands: [],
    voiceIntents: [],
    workflows: [],
    activation: { phrases: ["pdf"], slashCommands: [], auto: true },
    settings: [],
    rating: { average: 0, count: 0 },
    downloads: 0,
    runs: 0,
    favorite: false,
    pinned: false,
    grantedPermissions: ["fs:read"],
    installedAt: 1,
    updatedAt: 1,
    sourceUrl: null,
    quarantine: { quarantined: false, until: null, remainingMs: 0, pendingGrants: [], reason: null },
    settingsValues: {},
    errors: [],
    warnings: [],
    updateAvailable: false,
    ...over,
  };
}

describe("categories", () => {
  test("the sidebar rows match the brief and end with Custom MCP", () => {
    expect(CATEGORY_DEFS.map((d) => d.id)).toEqual([
      "featured", "installed", "updates", "developer", "productivity", "research", "creative",
      "browser", "files", "communication", "operations", "data", "memory", "agents", "security", "custom-mcp",
    ]);
    expect(CATEGORY_DEFS.find((d) => d.id === "custom-mcp")?.action).toBe("add-mcp");
  });

  test("engine categories and tag hints both map a skill into a row", () => {
    const pdf = rec();
    const files = CATEGORY_DEFS.find((d) => d.id === "files")!;
    expect(categoryMatches(pdf, files)).toBe(true); // "pdf" tag hint
    const productivity = CATEGORY_DEFS.find((d) => d.id === "productivity")!;
    expect(categoryMatches(pdf, productivity)).toBe(true);
    const dev = CATEGORY_DEFS.find((d) => d.id === "developer")!;
    expect(categoryMatches(pdf, dev)).toBe(false);
  });

  test("installed / updates are state filters, not category filters", () => {
    const a = rec({ id: "a", installed: true, updateAvailable: true });
    const b = rec({ id: "b", installed: false });
    expect(filterByCategory([a, b], "installed").map((r) => r.id)).toEqual(["a"]);
    expect(filterByCategory([a, b], "updates").map((r) => r.id)).toEqual(["a"]);
    expect(filterByCategory([a, b], "featured").map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("trust vocabulary (never overstates)", () => {
  test("official and verified are trusted; unknown or unsigned is 'unsigned'", () => {
    expect(trustOf({ verification: "official", signed: true, source: "bundled" })).toBe("official");
    expect(trustOf({ verification: "verified", signed: true, source: "registry" })).toBe("verified");
    expect(trustOf({ verification: "unverified", signed: false, source: "local" })).toBe("unsigned");
    expect(trustOf({ verification: "unknown", signed: false, source: "local" })).toBe("unsigned");
  });

  test("a community skill with a signature is labelled community, not verified", () => {
    expect(trustOf({ verification: "community", signed: true, source: "registry" })).toBe("community");
  });
});

describe("permission chips", () => {
  test("shell and secrets are dangerous and carry consequence copy", () => {
    const shell = permissionChip({ scope: "shell", reason: "runs tests", optional: false, dangerous: false, paths: [], domains: [] });
    expect(shell.dangerous).toBe(true);
    expect(shell.consequence).toBe("Can run shell commands on your computer.");
    const secrets = permissionChip({ scope: "secrets", reason: "", optional: false, dangerous: false, paths: [], domains: [] });
    expect(secrets.label).toBe("Credentials");
  });

  test("read-only file access is safe", () => {
    expect(permissionChip({ scope: "fs:read", reason: "", optional: false, dangerous: false, paths: [], domains: [] }).dangerous).toBe(false);
  });

  test("dangerSummary names the worst consequence first", () => {
    const r = rec({
      permissions: [
        { scope: "fs:write", reason: "", optional: false, dangerous: true, paths: [], domains: [] },
        { scope: "shell", reason: "", optional: false, dangerous: true, paths: [], domains: [] },
      ],
    });
    expect(hasDangerousPermissions(r)).toBe(true);
    expect(dangerSummary(r)).toBe("Can run shell commands on your computer.");
  });
});

describe("card state", () => {
  test("maps engine flags to exactly one state, quarantine winning over update", () => {
    expect(cardState(rec({ installed: false }))).toBe("install");
    expect(cardState(rec({ installed: true, enabled: true }))).toBe("installed");
    expect(cardState(rec({ installed: true, enabled: false }))).toBe("disabled");
    expect(cardState(rec({ installed: true, updateAvailable: true }))).toBe("update");
    expect(
      cardState(rec({ installed: true, updateAvailable: true, quarantine: { quarantined: true, until: 1, remainingMs: 1, pendingGrants: [], reason: "unsigned" } })),
    ).toBe("quarantined");
  });
});

describe("brand monograms", () => {
  test("known integrations get their brand colour and monogram", () => {
    const gmail = brandFor(rec({ id: "gmail_connector", name: "Gmail", tags: ["email"] }));
    expect(gmail?.monogram).toBe("G");
    expect(gmail?.color).toBe("#EA4335");
  });

  test("unknown skills get no brand (category colour fallback)", () => {
    expect(brandFor(rec({ id: "copywriter", name: "Copywriter", tags: ["writing"] }))).toBeNull();
  });
});

describe("search and formatting", () => {
  test("every term must match (AND), case-insensitive", () => {
    const r = rec();
    expect(matchesQuery(r, "PDF")).toBe(true);
    expect(matchesQuery(r, "pdf documents")).toBe(true);
    expect(matchesQuery(r, "pdf shell")).toBe(false);
    expect(matchesQuery(r, "   ")).toBe(true);
  });

  test("install counts compact to k/m", () => {
    expect(formatCount(950)).toBe("950");
    expect(formatCount(12400)).toBe("12.4k");
    expect(formatCount(2_000_000)).toBe("2m");
  });
});
