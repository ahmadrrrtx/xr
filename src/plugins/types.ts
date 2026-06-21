/**
 * XR Stage 10 — plugin platform shared types and manifest schema.
 *
 * The manifest is a strict data contract. It declares identity, compatibility,
 * permissions, capabilities, hooks, skills, MCP servers, source, and trust
 * metadata. Declaration is not authority: install and load still validate the
 * file tree, hashes, compatibility, policy, and granted permissions.
 */
import { z } from "zod";

// ── Permissions ───────────────────────────────────────────────────────────────

export const PERMISSION_SCOPES = [
  "fs:read",
  "fs:write",
  "net",
  "browser",
  "memory:read",
  "memory:write",
  "provider",
  "voice",
  "control",
  "secrets",
  "ui",
  "mcp",
  "shell",
] as const;

export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

export function isPermissionScope(v: string): v is PermissionScope {
  return (PERMISSION_SCOPES as readonly string[]).includes(v);
}

export const PERMISSION_HELP: Record<PermissionScope, string> = {
  "fs:read": "Read files inside this plugin's private data directory only.",
  "fs:write": "Write files inside this plugin's private data directory only.",
  net: "Make outbound network requests through XR's egress allow-list.",
  browser: "Request browser automation through XR-controlled surfaces.",
  "memory:read": "Recall durable memory through XR's memory rules.",
  "memory:write": "Add durable memory with plugin provenance and audit records.",
  provider: "Call the active model through XR's provider and budget gates.",
  voice: "Contribute voice behavior or request speech surfaces.",
  control: "Request computer-control actions; confirmation gates still apply.",
  secrets: "Read named secrets only; values are never logged by XR.",
  ui: "Contribute declarative dashboard/UI metadata.",
  mcp: "Register MCP servers or MCP-backed tools; calls are approval-gated.",
  shell: "Request process/shell access; disabled by default and high risk.",
};

export const SENSITIVE_PERMISSIONS: ReadonlySet<PermissionScope> = new Set([
  "fs:write",
  "net",
  "browser",
  "memory:write",
  "provider",
  "voice",
  "control",
  "secrets",
  "ui",
  "mcp",
  "shell",
]);

// ── Plugin types ──────────────────────────────────────────────────────────────

export const PLUGIN_TYPES = [
  "tool",
  "skill",
  "integration",
  "provider",
  "memory",
  "research",
  "automation",
  "ui",
  "mcp",
  "voice",
  "security",
  "business",
  "developer",
  "workflow",
] as const;

export type PluginType = (typeof PLUGIN_TYPES)[number];

export function isPluginType(v: string): v is PluginType {
  return (PLUGIN_TYPES as readonly string[]).includes(v);
}

export const TRUST_LEVELS = ["unknown", "community", "reviewed", "verified", "official", "local-dev"] as const;
export type PluginTrustLevel = (typeof TRUST_LEVELS)[number];

export const CAPABILITY_KINDS = [
  "tool",
  "command",
  "skill",
  "integration",
  "provider",
  "memory",
  "research",
  "automation",
  "ui",
  "mcp",
  "voice",
  "security",
  "workflow",
] as const;
export type PluginCapabilityKind = (typeof CAPABILITY_KINDS)[number];

export const SourceSchema = z.object({
  kind: z.enum(["local", "builtin", "catalog", "git", "url", "mcpb", "unknown"]).default("unknown"),
  url: z.string().max(800).optional(),
  ref: z.string().max(120).optional(),
  registry: z.string().max(200).optional(),
});

export const CapabilitySchema = z.object({
  kind: z.enum(CAPABILITY_KINDS),
  name: z.string().min(1).max(120).regex(/^[a-z0-9._:@/-]+$/i),
  description: z.string().max(500).optional(),
});

export const UiHookSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[a-z0-9._:-]+$/i),
  surface: z.enum(["dashboard", "settings", "sidebar", "status", "command-palette"]),
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});

export const McpServerSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[a-z0-9._:-]+$/i),
  transport: z.enum(["http", "stdio"]).default("http"),
  url: z.string().url().optional(),
  command: z.string().max(240).optional(),
  args: z.array(z.string().max(300)).default([]),
  apiKeyEnv: z.string().max(120).optional(),
  tools: z.array(z.string().max(120)).default([]),
  description: z.string().max(500).optional(),
});

const SEMVER_RANGE = /^[\d.\sxX*<>=~^|-]+$/;
const REL_PATH = z
  .string()
  .min(1)
  .max(240)
  .refine((p) => !p.startsWith("/") && !p.startsWith("\\") && !p.includes(".."), "must be a contained relative path");

export const ManifestSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z
    .string()
    .min(2)
    .max(96)
    .regex(/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i, "invalid plugin id"),
  name: z.string().min(1).max(160),
  version: z.string().min(1).max(40),
  author: z.string().max(200).default("unknown"),
  description: z.string().max(2000).default(""),
  type: z.enum(PLUGIN_TYPES).default("tool"),
  entrypoint: REL_PATH.default("index.ts"),
  permissions: z.array(z.enum(PERMISSION_SCOPES)).default([]),
  capabilities: z.array(CapabilitySchema).default([]),
  dependencies: z.array(z.string().max(96)).default([]),
  compatibility: z.string().max(64).regex(SEMVER_RANGE, "invalid compatibility range").default("*"),
  apiVersion: z.number().int().min(1).default(1),
  source: z.union([z.string().max(800), SourceSchema]).optional(),
  sourceUrl: z.string().max(800).optional(),
  updateSource: z.string().max(800).optional(),
  trustLevel: z.enum(TRUST_LEVELS).default("unknown"),
  trust: z
    .object({
      sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
      treeSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
      signature: z.string().max(4000).optional(),
      keyId: z.string().max(160).optional(),
      reviewedBy: z.string().max(200).optional(),
      reviewedAt: z.string().max(80).optional(),
    })
    .default({}),
  uiHooks: z.array(UiHookSchema).default([]),
  commandHooks: z.array(z.string().min(1).max(80).regex(/^[a-z0-9._:-]+$/i)).default([]),
  toolHooks: z.array(z.string().min(1).max(80).regex(/^[a-z0-9._:-]+$/i)).default([]),
  mcpServers: z.array(McpServerSchema).default([]),
  skillPaths: z.array(REL_PATH).default([]),
  homepage: z.string().max(800).optional(),
  license: z.string().max(80).optional(),
  keywords: z.array(z.string().max(40)).default([]),
});

export type PluginManifest = z.infer<typeof ManifestSchema>;
export type McpServerDeclaration = z.infer<typeof McpServerSchema>;
export type PluginCapability = z.infer<typeof CapabilitySchema>;

// ── Registry / health ────────────────────────────────────────────────────────

export type PluginHealthState = "unknown" | "healthy" | "degraded" | "error" | "untrusted" | "incompatible" | "disabled";

export interface PluginHealth {
  state: PluginHealthState;
  checkedAt?: number;
  detail?: string;
  errors?: string[];
}

export interface PluginRecord {
  id: string;
  dir: string;
  manifest: PluginManifest;
  enabled: boolean;
  grantedPermissions: PermissionScope[];
  installedAt: number;
  updatedAt: number;
  status: PluginStatus;
  reason?: string;
}

export type PluginStatusKind = "enabled" | "disabled" | "incompatible" | "error" | "untrusted";

export interface PluginStatus {
  kind: PluginStatusKind;
  loaded: boolean;
  contributions?: number;
  detail?: string;
}

// ── Contributions ────────────────────────────────────────────────────────────

export interface PluginCommand {
  name: string;
  description?: string;
  run(argv: string[]): Promise<void> | void;
}

export interface PluginTool {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  requiresApproval?: boolean;
  run(args: Record<string, unknown>): Promise<PluginToolResult> | PluginToolResult;
}

export interface PluginToolResult {
  ok: boolean;
  output: string;
  data?: unknown;
}

export interface PluginPrompt {
  id: string;
  description?: string;
  template: string;
}

export interface PluginContributions {
  commands?: PluginCommand[];
  tools?: PluginTool[];
  prompts?: PluginPrompt[];
  dispose?(): void | Promise<void>;
}

export type PluginActivate = (host: import("./host.ts").PluginHost) => PluginContributions | Promise<PluginContributions>;

export interface PluginModule {
  activate?: PluginActivate;
  default?: PluginActivate | { activate: PluginActivate };
}

export type { PluginHost } from "./host.ts";
