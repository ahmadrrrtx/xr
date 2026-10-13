/**
 * Example data for the admin console.
 *
 * ## Why this exists
 *
 * The console is a client-rendered surface that reads from a live cloud service.
 * There are three situations in which that service is not reachable and the
 * console should still be reviewable rather than blank:
 *
 *   1. A self-hosted or preview deployment with no `NEXT_PUBLIC_XR_CLOUD_API` set.
 *   2. A design review, where someone is looking at the layout and not the data.
 *   3. A screenshot pipeline (this build was authored in one) with no network.
 *
 * None of those is a reason to build fake behaviour, so nothing here is
 * interactive: the console renders these rows **read-only** and shows a banner
 * saying they are examples. Mutating actions are disabled rather than hidden, so
 * the layout a reviewer sees is the layout that ships.
 *
 * ## Why the values were chosen carefully rather than filled in randomly
 *
 * Demo data is documentation. It is the first place a reviewer learns what a
 * policy looks like, what an audit entry contains, and which fields matter. Lorem
 * ipsum here would teach the wrong shape, and a reviewer approving a layout built
 * on `foo@example.com` has not really reviewed anything.
 *
 * The organization is a plausible twelve-person team, the caps are the shipped
 * defaults from `cloud/src/services/policy.ts`, and the audit entries are the
 * actions the API actually emits.
 */

import type { ApiKey, AuditEntry, Entitlement, Fact, Member, PolicyView, Team } from "./cloud";

const now = Date.now();
const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();
const ahead = (days: number) => new Date(now + days * 86_400_000).toISOString();

export const demoTeam: Team = {
  id: "org_7Kd2mQp4Lx",
  name: "Northwind Robotics",
  slug: "northwind-robotics",
  role: "owner",
  memberStatus: "active",
  joinedAt: ago(212),
  plan: "business",
  planStatus: "active",
  trialEndsAt: null,
  seats: 12,
  cancelAtPeriodEnd: false,
  deletionScheduledAt: null,
};

export const demoEntitlement: Entitlement = {
  plan: "business",
  status: "active",
  seats: 12,
  interval: "month",
  businessActive: true,
  features: [
    "team",
    "team-workspaces",
    "sso-admin",
    "managed-models",
    "relay",
    "memory-sync",
    "audit-export",
    "admin-console",
  ],
  reason: null,
  trial: null,
  currentPeriodEnd: ahead(18),
  cancelAtPeriodEnd: false,
  isPastDue: false,
  note:
    "Everything in XR that runs on your own machine — voice, local memory, themes, the CLI, bots, editors, " +
    "research, agents, skills and MCP — is unaffected by anything on this page.",
};

export const demoMembers: Member[] = [
  {
    id: "mem_2Rk9dPq",
    userId: "usr_a91Kdm",
    email: "aisha@northwind.example",
    name: "Aisha Rahman",
    role: "owner",
    status: "active",
    joinedAt: ago(212),
    lastActiveAt: ago(0),
    ssoBound: true,
    dailyCapMicroUsd: null,
    monthlyCapMicroUsd: null,
    byokOnly: false,
  },
  {
    id: "mem_8Vb3nWz",
    userId: "usr_b77Xmt",
    email: "daniel@northwind.example",
    name: "Daniel Okonjo",
    role: "admin",
    status: "active",
    joinedAt: ago(180),
    lastActiveAt: ago(0),
    ssoBound: true,
    dailyCapMicroUsd: 5_000_000,
    monthlyCapMicroUsd: 40_000_000,
    byokOnly: false,
  },
  {
    id: "mem_4Jc7tQe",
    userId: "usr_c12Plr",
    email: "sofia@northwind.example",
    name: "Sofia Marchetti",
    role: "member",
    status: "active",
    joinedAt: ago(96),
    lastActiveAt: ago(1),
    ssoBound: true,
    dailyCapMicroUsd: null,
    monthlyCapMicroUsd: 10_000_000,
    byokOnly: false,
  },
  {
    id: "mem_9Hs2vKy",
    userId: "usr_d98Nbf",
    email: "contractor@studio.example",
    name: "Wei Chen",
    role: "member",
    status: "active",
    joinedAt: ago(34),
    lastActiveAt: ago(3),
    ssoBound: false,
    dailyCapMicroUsd: 2_000_000,
    monthlyCapMicroUsd: 10_000_000,
    // A contractor on their own keys: XR-managed keys would mean the org pays for
    // someone who is not on payroll.
    byokOnly: true,
  },
  {
    id: "mem_6Tn5rLm",
    userId: "usr_e44Ghk",
    email: "priya@northwind.example",
    name: "Priya Nair",
    role: "member",
    status: "disabled",
    joinedAt: ago(150),
    lastActiveAt: ago(41),
    ssoBound: true,
    dailyCapMicroUsd: null,
    monthlyCapMicroUsd: null,
    byokOnly: false,
  },
];

export const demoPolicy: PolicyView = {
  // $150 of pooled managed-model spend per month, then per-user caps apply.
  includedQuotaMicroUsd: 150_000_000,
  defaultDailyBudgetMicroUsd: 10_000_000,
  defaultMonthlyBudgetMicroUsd: 50_000_000,
  teamMonthlyBudgetMicroUsd: 200_000_000,
  // Anything over $3 needs an admin's approval first.
  requireApprovalAboveMicroUsd: 3_000_000,
  allowedProviders: [
    { provider: "anthropic" },
    { provider: "openai", models: ["gpt-4.1", "o3-mini"] },
    { provider: "google", models: ["gemini-2.5-pro"] },
  ],
  egressRules: [
    { destination: "api.anthropic.com", note: "managed models" },
    { destination: "api.openai.com", note: "managed models" },
    { destination: "gateway.northwind.example", note: "internal tools" },
  ],
  dataRetentionDays: 90,
  auditRetentionDays: 365,
  blockSensitiveMemory: false,
  disableByok: false,
  relayEnabled: true,
};

export const demoAudit: AuditEntry[] = [
  {
    id: "aud_9f2Kd",
    seq: 8841,
    action: "policy.update",
    actorKind: "user",
    actorEmail: "daniel@northwind.example",
    targetType: "policy",
    targetId: "pol_4Kd9",
    ip: "203.0.113.x",
    at: ago(0.2),
    entryHash: "b41f7c9e2a8d5f03",
    detail: {
      before: { requireApprovalAboveMicroUsd: 1_000_000, allowedProviders: ["anthropic", "openai", "google"] },
      after: { requireApprovalAboveMicroUsd: 3_000_000, allowedProviders: ["anthropic", "openai"] },
    },
  },
  {
    id: "aud_7h1Mv",
    seq: 8840,
    action: "member.role_changed",
    actorKind: "user",
    actorEmail: "aisha@northwind.example",
    targetType: "member",
    targetId: "mem_4Jc7tQe",
    ip: "203.0.113.x",
    at: ago(1.1),
    entryHash: "0c93aa71de44b820",
    detail: { before: { role: "member" }, after: { role: "member" }, note: "cap raised only" },
  },
  {
    id: "aud_3p8Qz",
    seq: 8839,
    action: "memory.write",
    actorKind: "user",
    actorEmail: "sofia@northwind.example",
    targetType: "memory",
    targetId: "fact_2Lm4",
    ip: "198.51.100.x",
    at: ago(2.4),
    entryHash: "77e1b0c4aa93f2d6",
    detail: { workspace: "platform", visibility: "team", category: "procedure", bodyLength: 184 },
  },
  {
    id: "aud_5k2Wt",
    seq: 8838,
    action: "sso.enforcement_changed",
    actorKind: "user",
    actorEmail: "aisha@northwind.example",
    targetType: "sso",
    targetId: "org_7Kd2mQp4Lx",
    ip: "203.0.113.x",
    at: ago(6.7),
    entryHash: "1ad4f9b633e07c15",
    detail: { before: { enforced: false }, after: { enforced: true } },
  },
  {
    id: "aud_2d6Yb",
    seq: 8837,
    action: "audit.export",
    actorKind: "user",
    actorEmail: "daniel@northwind.example",
    targetType: "export",
    targetId: "exp_8Tq2",
    ip: "203.0.113.x",
    at: ago(9.2),
    entryHash: "9c02be5f31a7d480",
    detail: { format: "csv", rows: 8841, from: ago(39), to: ago(9) },
  },
  {
    id: "aud_6f4Rc",
    seq: 8836,
    action: "auth.signin",
    actorKind: "user",
    actorEmail: "contractor@studio.example",
    targetType: "session",
    targetId: "ses_5Km9",
    ip: "192.0.2.x",
    at: ago(11.5),
    entryHash: "3e8817a0cd52f9b1",
    detail: { method: "sso" },
  },
];

export const demoFacts: Fact[] = [
  {
    id: "fact_2Lm4",
    workspaceId: "wsp_platform",
    category: "procedure",
    visibility: "team",
    body: "Release trains leave on Tuesdays. Anything not merged by Monday 16:00 UTC goes to the following week — this has been the rule since the November incident and it is not negotiable for a single feature.",
    tags: ["release", "process"],
    version: 4,
    updatedAt: ago(2.4),
  },
  {
    id: "fact_7Kq9",
    workspaceId: "wsp_platform",
    category: "fact",
    visibility: "team",
    body: "The staging database is a nightly restore of production with the customer table's email column replaced by a deterministic hash. It is safe to query and unsafe to write to.",
    tags: ["staging", "data"],
    version: 2,
    updatedAt: ago(12),
  },
  {
    id: "fact_4Nb1",
    workspaceId: "wsp_ops",
    category: "preference",
    visibility: "team",
    body: "Infrastructure changes go through a pull request even for one-line fixes. Applied by hand twice and both times nobody could say what had changed three weeks later.",
    tags: ["infra"],
    version: 1,
    updatedAt: ago(28),
  },
  {
    id: "fact_9Vd3",
    workspaceId: "wsp_research",
    category: "summary",
    visibility: "review",
    body: "Candidate: the evaluation harness now runs on every PR touching src/agents, adding roughly nine minutes to CI. Suggested by the agent after three consecutive regressions landed on a Friday.",
    tags: ["ci", "agents"],
    version: 1,
    updatedAt: ago(0.6),
  },
];

export const demoApiKeys: ApiKey[] = [
  {
    id: "key_4Km9Ta",
    name: "CI — eval harness",
    prefix: "xr_live_7Qk2",
    scopes: ["models:invoke"],
    createdAt: ago(88),
    lastUsedAt: ago(0.05),
    expiresAt: null,
  },
  {
    id: "key_2Pv7Rb",
    name: "Grafana exporter",
    prefix: "xr_live_3Bd8",
    scopes: ["usage:read"],
    createdAt: ago(60),
    lastUsedAt: ago(0.2),
    expiresAt: null,
  },
  {
    id: "key_8Hs1Lc",
    name: "Contractor sandbox (expiring)",
    prefix: "xr_test_9Ml4",
    scopes: ["models:invoke"],
    createdAt: ago(30),
    lastUsedAt: ago(4),
    expiresAt: ahead(12),
  },
];

export const demoWorkspaces = [
  { id: "wsp_platform", name: "Platform", slug: "platform", factCount: 42, members: 9, visibility: "team" },
  { id: "wsp_ops", name: "Operations", slug: "ops", factCount: 17, members: 4, visibility: "team" },
  { id: "wsp_research", name: "Research", slug: "research", factCount: 63, members: 6, visibility: "team" },
  { id: "wsp_private", name: "Aisha (personal)", slug: "aisha-private", factCount: 5, members: 1, visibility: "private" },
];
