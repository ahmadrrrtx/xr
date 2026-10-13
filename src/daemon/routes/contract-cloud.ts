/**
 * XR Daemon API v1 — cloud operation contract (Phase 30).
 *
 * Extracted from contract.ts on purpose: that file's size waiver recorded a plan
 * — "next phase that adds a contract moves its entries into its own
 * contract-<phase>.ts and registers them from a single barrel" — and this is that
 * phase. One import and one spread, no growth in the central registry.
 *
 * These are `stable`, not `experimental`, because the shapes are pinned by
 * test/cloud/routes.test.ts rather than by convention, and because the whole
 * point of these routes is that a client can rely on them when the cloud is
 * unreachable: `available: false` with a reason and a repair is a contract, not
 * a fallback.
 */

import type { ApiOperationMeta } from "./contract.ts";

export const CLOUD_CONTRACT: Record<string, ApiOperationMeta> = {
  "cloud.license.get": {
    summary: "Business licence state, verified offline against the built-in key.",
    tag: "cloud",
    stability: "stable",
  },
  "cloud.license.verify": {
    summary: "Verify a submitted licence token without storing it.",
    tag: "cloud",
    stability: "stable",
  },
  "cloud.license.feature": {
    summary: "Whether one Business feature is available (?feature=…).",
    tag: "cloud",
    stability: "stable",
    template: "/api/cloud/license/feature/{feature}",
    pathParams: [{ name: "feature", description: "One of BUSINESS_FEATURES." }],
  },
  "cloud.session.get": {
    summary: "Whether XR is signed in to a team (never fails when it is not).",
    tag: "cloud",
    stability: "stable",
  },
  "cloud.session.delete": {
    summary: "Sign out of the team; leaves all local data untouched.",
    tag: "cloud",
    stability: "stable",
  },
  "cloud.team-memory.get": {
    summary: "Team memory facts for one shared workspace (?workspaceId=).",
    tag: "cloud",
    stability: "stable",
  },
  "cloud.team-memory.post": {
    summary: "Promote a fact to a team workspace (sensitivity-vetted locally first).",
    tag: "cloud",
    stability: "stable",
  },
  "cloud.team-memory.delete": {
    summary: "Delete a team fact (administrative on the server).",
    tag: "cloud",
    stability: "stable",
    template: "/api/cloud/team-memory/{factId}",
    pathParams: [{ name: "factId", description: "The team fact to delete." }],
  },
  "cloud.teams.get": {
    summary: "Teams this installation belongs to (degrades to available:false offline).",
    tag: "cloud",
    stability: "stable",
  },
  "cloud.team-workspaces.get": {
    summary: "Shared team workspaces (degrades to available:false without a team).",
    tag: "cloud",
    stability: "stable",
  },
  "cloud.usage.get": {
    summary: "Managed-model usage for the current organization.",
    tag: "cloud",
    stability: "stable",
  },
};
