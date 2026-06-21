/**
 * XR Stage 11 — MCP (Model Context Protocol) Platform Types
 *
 * Full conformance to MCP 2025-06-18 spec (tools, resources, prompts).
 * Secure, permissioned, discoverable, lifecycle-managed.
 * MCP servers are opt-in, inspectable, and gated.
 */

import { z } from "zod";

// ── Core MCP Protocol Types (aligned to spec) ────────────────────────────────

export const MCP_VERSION = "2025-06-18";

export type McpTransport = "stdio" | "sse" | "http" | "streamable-http";

export const MCP_TRANSPORTS: McpTransport[] = ["stdio", "sse", "http", "streamable-http"];

export type McpServerType = "local" | "remote";

export interface McpCapability {
  tools?: boolean;
  resources?: boolean;
  prompts?: boolean;
  sampling?: boolean;
  roots?: boolean;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>; // JSON Schema
}

export interface McpResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: McpCapability;
  serverInfo: McpServerInfo;
}

// ── XR MCP Server Record / Registry State ────────────────────────────────────

export const MCP_PERMISSION_SCOPES = [
  "fs:read", "fs:write", "net", "browser", "memory:read", "memory:write",
  "provider", "voice", "control", "secrets", "ui", "shell", "git", "db", "workflow"
] as const;

export type McpPermissionScope = (typeof MCP_PERMISSION_SCOPES)[number];

export const MCP_TRUST_LEVELS = ["unknown", "community", "reviewed", "verified", "official", "local-dev", "untrusted"] as const;
export type McpTrustLevel = (typeof MCP_TRUST_LEVELS)[number];

export const MCP_HEALTH_STATES = ["unknown", "healthy", "degraded", "error", "unreachable", "disabled", "untrusted"] as const;
export type McpHealthState = (typeof MCP_HEALTH_STATES)[number];

export interface McpServerConfig {
  id: string;
  name: string;
  version: string;
  description?: string;

  // Source & trust
  source: "local" | "remote" | "registry" | "plugin" | "manual";
  sourceUrl?: string;
  installedAt: number;
  updatedAt: number;

  // Connection
  transport: McpTransport;
  localOrRemote: McpServerType;
  url?: string;                    // for http/sse
  command?: string;                // for stdio
  args?: string[];
  env?: Record<string, string>;    // safe env subset
  apiKeyEnv?: string;              // never store value

  // Declared capabilities & permissions (from server or manifest)
  declaredCapabilities: McpCapability;
  declaredPermissions: McpPermissionScope[];
  tools?: McpTool[];
  resources?: McpResource[];
  prompts?: McpPrompt[];

  // Runtime state
  enabled: boolean;
  trustLevel: McpTrustLevel;
  checksum?: string;               // optional sha256 of manifest or binary
  lastHealthCheckAt?: number;
  health: McpHealthState;
  healthDetail?: string;

  // Usage stats
  invocationCount: number;
  lastInvokedAt?: number;

  // Lifecycle
  history?: Array<{ at: number; action: string; detail?: string }>;
}

export interface McpRegistryEntry extends McpServerConfig {
  // Additional registry-only fields
  dirName?: string; // for local stdio servers
}

// ── MCP Client Session State ─────────────────────────────────────────────────

export interface McpSession {
  serverId: string;
  transport: McpTransport;
  connected: boolean;
  capabilities: McpCapability;
  serverInfo?: McpServerInfo;
  client: any; // internal transport client
}

// ── Invocation Results ───────────────────────────────────────────────────────

export interface McpToolResult {
  ok: boolean;
  content: string;
  data?: unknown;
  error?: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

export interface McpPromptResult {
  ok: boolean;
  messages: Array<{ role: string; content: string }>;
  error?: string;
}

// ── Registry Schemas (for persistence) ───────────────────────────────────────

export const McpServerConfigSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(160),
  version: z.string().min(1).max(40),
  description: z.string().max(2000).optional(),

  source: z.enum(["local", "remote", "registry", "plugin", "manual"]),
  sourceUrl: z.string().max(800).optional(),
  installedAt: z.number(),
  updatedAt: z.number(),

  transport: z.enum(MCP_TRANSPORTS),
  localOrRemote: z.enum(["local", "remote"]),
  url: z.string().url().optional(),
  command: z.string().max(300).optional(),
  args: z.array(z.string().max(300)).default([]),
  env: z.record(z.string()).default({}),
  apiKeyEnv: z.string().max(120).optional(),

  declaredCapabilities: z.object({
    tools: z.boolean().optional(),
    resources: z.boolean().optional(),
    prompts: z.boolean().optional(),
    sampling: z.boolean().optional(),
    roots: z.boolean().optional(),
  }).default({}),
  declaredPermissions: z.array(z.enum(MCP_PERMISSION_SCOPES)).default([]),
  tools: z.array(z.object({ name: z.string(), description: z.string().optional(), inputSchema: z.any().optional() })).default([]),
  resources: z.array(z.object({ uri: z.string(), name: z.string().optional(), description: z.string().optional(), mimeType: z.string().optional() })).default([]),
  prompts: z.array(z.object({ name: z.string(), description: z.string().optional(), arguments: z.array(z.any()).optional() })).default([]),

  enabled: z.boolean().default(false),
  trustLevel: z.enum(MCP_TRUST_LEVELS).default("unknown"),
  checksum: z.string().optional(),
  lastHealthCheckAt: z.number().optional(),
  health: z.enum(MCP_HEALTH_STATES).default("unknown"),
  healthDetail: z.string().optional(),

  invocationCount: z.number().default(0),
  lastInvokedAt: z.number().optional(),

  history: z.array(z.object({ at: z.number(), action: z.string(), detail: z.string().optional() })).default([]),
});

export type McpServerConfigInput = z.input<typeof McpServerConfigSchema>;

// ── Discovery / Catalog Entry (lightweight) ──────────────────────────────────

export interface McpCatalogEntry {
  id: string;
  name: string;
  version: string;
  description?: string;
  transport: McpTransport;
  sourceUrl?: string;
  trustLevel: McpTrustLevel;
  declaredPermissions: McpPermissionScope[];
  capabilities: McpCapability;
  tags?: string[];
}

// ── Helper Types ─────────────────────────────────────────────────────────────

export interface McpHealthReport {
  id: string;
  state: McpHealthState;
  detail?: string;
  checkedAt: number;
  toolsCount: number;
  resourcesCount: number;
  promptsCount: number;
}

export function isMcpPermissionScope(v: string): v is McpPermissionScope {
  return (MCP_PERMISSION_SCOPES as readonly string[]).includes(v);
}

export const MCP_PERMISSION_HELP: Record<McpPermissionScope, string> = {
  "fs:read": "Read files (sandboxed to declared paths).",
  "fs:write": "Write files (sandboxed).",
  net: "Outbound network through XR egress controls.",
  browser: "Browser automation via XR control layer.",
  "memory:read": "Read durable memory.",
  "memory:write": "Write durable memory entries.",
  provider: "Use LLM provider (budget & safety gated).",
  voice: "Voice surfaces and audio.",
  control: "Computer control (requires user confirmation).",
  secrets: "Access named secrets (explicit only, never logged).",
  ui: "Contribute MCP UI surfaces.",
  shell: "Shell/process execution (HIGH RISK — explicit only).",
  git: "Git operations.",
  db: "Database access.",
  workflow: "Workflow automation.",
};

export const MCP_SENSITIVE_PERMISSIONS = new Set<McpPermissionScope>([
  "fs:write", "net", "browser", "memory:write", "control", "secrets", "shell", "provider"
]);
