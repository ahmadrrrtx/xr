/**
 * Phase 22 — Integrations pure core (desktop/src/integrations/core.ts) and the
 * xr://oauth/callback parser (desktop/src/integrations/oauthCallback.ts).
 * Relative imports, same convention as the other desktop tests.
 */
import { describe, expect, test } from "bun:test";

import {
  brandFor,
  parseOAuthCallback,
  connectedSince,
  countByCategory,
  deriveCardState,
  filterIntegrations,
  lastSyncLabel,
  requestedScopeLines,
} from "../../desktop/src/integrations/core.ts";
import { ConnectorRegistry } from "../../src/integrations/registry.ts";

const base = {
  support: "available" as const,
  status: "disconnected" as const,
  needsAppCredentials: false,
  hasAppCredentials: false,
};

describe("card state", () => {
  test("coming soon wins over everything else", () => {
    expect(deriveCardState({ ...base, support: "coming_soon", status: "connected" })).toBe("coming_soon");
  });

  test("expired and error both show re-auth", () => {
    expect(deriveCardState({ ...base, status: "expired" })).toBe("reauth");
    expect(deriveCardState({ ...base, status: "error" })).toBe("reauth");
  });

  test("connected shows the connected footer", () => {
    expect(deriveCardState({ ...base, status: "connected" })).toBe("connected");
  });

  test("OAuth without BYOK credentials shows setup, with them shows connect", () => {
    expect(deriveCardState({ ...base, needsAppCredentials: true, hasAppCredentials: false })).toBe("setup_required");
    expect(deriveCardState({ ...base, needsAppCredentials: true, hasAppCredentials: true })).toBe("connect");
  });

  test("a browser sign-in in progress is local state, shown as connecting", () => {
    expect(deriveCardState(base, true)).toBe("connecting");
  });
});

describe("search and category", () => {
  const items = [
    { id: "github", name: "GitHub", description: "Manage repositories", category: "development", capabilities: ["create_pr"] },
    { id: "coolify", name: "Coolify", description: "Manage self-hosted infrastructure", category: "infrastructure", capabilities: ["read_deployments"] },
    { id: "gmail", name: "Gmail", description: "Read and send email", category: "communication", capabilities: ["send_email"] },
  ];

  test("every term must match, case-insensitively", () => {
    expect(filterIntegrations(items, { category: "all", query: "GIT" }).map((i) => i.id)).toEqual(["github"]);
    expect(filterIntegrations(items, { category: "all", query: "manage self" }).map((i) => i.id)).toEqual(["coolify"]);
    expect(filterIntegrations(items, { category: "all", query: "git send" })).toEqual([]);
  });

  test("category filter combines with search", () => {
    expect(filterIntegrations(items, { category: "communication", query: "" }).map((i) => i.id)).toEqual(["gmail"]);
    expect(filterIntegrations(items, { category: "communication", query: "git" })).toEqual([]);
  });

  test("capabilities are searchable", () => {
    expect(filterIntegrations(items, { category: "all", query: "create_pr" }).map((i) => i.id)).toEqual(["github"]);
  });

  test("counts include every category and the all total", () => {
    expect(countByCategory(items)).toEqual({ all: 3, development: 1, infrastructure: 1, communication: 1 });
  });

  test("the registry has 32 connectors across the chips, so no connector is left without a category chip", () => {
    const reg = new ConnectorRegistry();
    const all = reg.list();
    expect(all.length).toBe(32);
    const chipIds = new Set(["communication", "calendar", "development", "storage", "crm_erp", "automation", "analytics", "payments", "commerce", "design", "infrastructure"]);
    expect(all.every((c) => chipIds.has(c.category))).toBe(true);
  });
});

describe("brand monograms", () => {
  test("known connectors get their monogram; unknown ones get a stable colour and an initial", () => {
    expect(brandFor("github", "GitHub").monogram).toBe("GH");
    const a = brandFor("zeta_tool", "Zeta Tool");
    const b = brandFor("zeta_tool", "Zeta Tool");
    expect(a).toEqual(b);
    expect(a.monogram).toBe("Z");
    expect(a.color).toMatch(/^hsl\(/);
  });
});

describe("plain-English copy", () => {
  test("connected-since reads relative for the first week, a date after", () => {
    const now = Date.parse("2026-10-09T12:00:00Z");
    expect(connectedSince("2026-10-09T08:00:00Z", now)).toBe("Connected today");
    expect(connectedSince("2026-10-06T12:00:00Z", now)).toBe("Connected 3 days ago");
    expect(connectedSince("2026-09-01T12:00:00Z", now)).toMatch(/^Connected on /);
    expect(connectedSince(null, now)).toBeNull();
  });

  test("last sync is honest when nothing has run", () => {
    expect(lastSyncLabel(null)).toBe("Not synced yet");
    const now = Date.parse("2026-10-09T12:00:00Z");
    expect(lastSyncLabel("2026-10-09T11:30:00Z", now)).toBe("Synced 30 min ago");
  });

  test("scope lines come from the engine copy when present, otherwise the requested scope names", () => {
    const withCopy = requestedScopeLines({
      scopes: ["repo"],
      scopeCopy: { willAccess: ["Read repos"], willNotAccess: ["Delete repos"] },
    });
    expect(withCopy).toEqual({ willAccess: ["Read repos"], willNotAccess: ["Delete repos"] });
    const plain = requestedScopeLines({ scopes: ["repo"], scopeCopy: null });
    expect(plain.willAccess).toEqual(["Scope requested: repo"]);
    expect(plain.willNotAccess).toEqual([]);
  });
});

describe("xr://oauth/callback parser", () => {
  test("accepts the callback with code and state", () => {
    expect(parseOAuthCallback("xr://oauth/callback?code=abc123&state=st_1")).toEqual({ kind: "success", code: "abc123", state: "st_1" });
  });

  test("a provider denial is reported as denied, with the state so the daemon can consume it", () => {
    expect(parseOAuthCallback("xr://oauth/callback?error=access_denied&state=st_2")).toEqual({ kind: "denied", state: "st_2" });
  });

  test("anything else is ignored: other schemes, other paths, missing state, missing code", () => {
    expect(parseOAuthCallback("https://oauth/callback?code=a&state=b")).toBeNull();
    expect(parseOAuthCallback("xr://memory/open?code=a&state=b")).toBeNull();
    expect(parseOAuthCallback("xr://oauth/callback?code=a")).toBeNull();
    expect(parseOAuthCallback("xr://oauth/callback?state=b")).toBeNull();
    expect(parseOAuthCallback("not a url")).toBeNull();
  });

  test("oversized values are refused", () => {
    expect(parseOAuthCallback(`xr://oauth/callback?code=${"c".repeat(600)}&state=s`)).toBeNull();
    expect(parseOAuthCallback(`xr://oauth/callback?code=c&state=${"s".repeat(300)}`)).toBeNull();
  });
});

describe("the Connect button stays the only bright control", () => {
  test("a disconnected connector with no BYOK still shows setup, not connect", () => {
    expect(deriveCardState({ ...base, needsAppCredentials: true })).toBe("setup_required");
  });
});
