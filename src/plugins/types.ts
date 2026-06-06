/**
 * XR 1.0 — plugin ecosystem: shared vocabulary.
 *
 * This file is dependency-light on purpose (only zod) so every layer — manifest
 * parser, permission validator, loader, registry, CLI, host — speaks the same
 * language without importing the Store, a provider, or any UI code.
 *
 * Design rules (mirrors the rest of XR):
 *   • Manifests are DATA, never executable trust. A manifest only *declares*.
 *   • Permissions are EXPLICIT and least-privilege. Nothing is granted unless a
 *     human approved it and it is listed in the manifest.
 *   • A plugin never gets the Store, raw config, process.env, fetch, or fs.
 *     It only ever sees a frozen PluginHost whose capabilities are present ONLY
 *     for permissions it was granted.
 */
import { z } from "zod";

// ── Permissions ───────────────────────────────────────────────────────────────

/**
 * The fixed, closed set of permission scopes a plugin may request. Closed by
 * design: a plugin cannot invent a new capability the core does not understand.
 */
export const PERMISSION_SCOPES = [
  "fs:read", // read files inside the plugin's own data dir (never the user's cwd)
  "fs:write", // write files inside the plugin's own data dir
  "net", // outbound network — still constrained by the egress allow-list
  "shell", // run shell commands (highest risk; always approval-gated)
  "browser", // drive the Playwright browser surface (when available)
  "memory:read", // read durable user memory (recall)
  "memory:write", // add durable user memory (explicit, audited)
  "provider", // call the active LLM provider (spend-capped, never bypassable)
  "secrets", // read a NAMED secret (value never logged; name is audited)
  "voice", // contribute voice phrases / speak (future host surface)
  "control", // request safe computer-control actions (approval-gated)
  "ui", // contribute dashboard / UI panels (declarative, future surface)
] as const;

export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

export function isPermissionScope(v: string): v is PermissionScope {
  return (PERMISSION_SCOPES as readonly string[]).includes(v);
}

/** Human-readable explanation of what each permission lets a plugin do. */
export const PERMISSION_HELP: Record<PermissionScope, string> = {
  "fs:read": "Read files in the plugin's private data directory only.",
  "fs:write": "Write files in the plugin's private data directory only.",
  net: "Make outbound network requests (still limited by your egress allow-list).",
  shell: "Run shell commands (high risk — always asks for approval).",
  browser: "Drive the built-in browser automation surface.",
  "memory:read": "Read what XR remembers (durable memory recall).",
  "memory:write": "Save new durable memory entries (explicit and audited).",
  provider: "Call the active AI model (counts against your spend caps — never bypasses them).",
  secrets: "Read a specific named secret by name (the value is never logged).",
  voice: "Contribute voice phrases or speak responses.",
  control: "Request safe computer-control actions (always asks for approval).",
  ui: "Contribute dashboard or UI panels.",
};

/** Permissions considered sensitive enough to call out loudly at install time. */
export const SENSITIVE_PERMISSIONS: ReadonlySet<PermissionScope> = new Set([
  "shell",
  "secrets",
  "control",
  "net",
  "fs:write",
]);

// ── Plugin kinds ───────────────────────────────────────────────────────────────

export const PLUGIN_TYPES = [
  "tool",
  "integration",
  "provider",
  "memory",
  "research",
  "automation",
  "ui",
  "voice",
  "workflow",
] as const;

export type PluginType = (typeof PLUGIN_TYPES)[number];

export function isPluginType(v: string): v is PluginType {
  return (PLUGIN_TYPES as readonly string[]).includes(v);
}

// ── Manifest schema ────────────────────────────────────────────────────────────

const SEMVER_RANGE = /^[\d.\sxX*<>=~^|-]+$/; // permissive; real check is in compat.ts

/**
 * The plugin manifest (`xr-plugin.json`). Validated by zod so a malformed
 * manifest fails safely with a precise reason instead of crashing XR.
 */
export const ManifestSchema = z.object({
  /** Stable unique id, e.g. "github" or "@scope/github". */
  id: z
    .string()
    .min(2)
    .max(64)
    .regex(/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i, "invalid plugin id"),
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(40),
  author: z.string().max(200).default("unknown"),
  description: z.string().max(2000).default(""),
  type: z.enum(PLUGIN_TYPES).default("tool"),
  /** Relative path to the plugin entry module (default index.ts/js). */
  entrypoint: z.string().min(1).max(200).default("index.ts"),
  /** Declared permissions. Closed set; unknown scopes are rejected at parse. */
  permissions: z.array(z.enum(PERMISSION_SCOPES)).default([]),
  /** Other plugin ids this one needs to be enabled first. */
  dependencies: z.array(z.string().max(64)).default([]),
  /** Range of XR core versions this plugin supports, e.g. ">=1.0.0 <2.0.0". */
  compatibility: z
    .string()
    .max(64)
    .regex(SEMVER_RANGE, "invalid compatibility range")
    .default("*"),
  /** Host ABI version this plugin was built against. */
  apiVersion: z.number().int().min(1).default(1),
  /** Where the plugin was obtained from (informational + reproducibility). */
  source: z.string().max(400).optional(),
  /** Update source (e.g. a path or URL) for `xr plugins update`. */
  updateSource: z.string().max(400).optional(),
  /** Optional trust metadata (signature support is forward-looking). */
  trust: z
    .object({
      /** sha256 of the entrypoint file, recorded at install for tamper checks. */
      sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
      /** Detached signature (base64). Verified when a public key is configured. */
      signature: z.string().max(2000).optional(),
      /** Key id / fingerprint the signature was made with. */
      keyId: z.string().max(120).optional(),
    })
    .default({}),
  /** Optional homepage / docs link. */
  homepage: z.string().max(400).optional(),
});

export type PluginManifest = z.infer<typeof ManifestSchema>;

// ── Registry record (what XR persists about an installed plugin) ────────────────

export interface PluginRecord {
  id: string;
  /** Absolute install directory under XR_HOME/plugins/<id>. */
  dir: string;
  manifest: PluginManifest;
  enabled: boolean;
  /** Permissions the user actually granted (subset of manifest.permissions). */
  grantedPermissions: PermissionScope[];
  installedAt: number;
  updatedAt: number;
  /** Last observed health (recomputed on demand by the registry/doctor). */
  status: PluginStatus;
  /** If status is "error"/"incompatible", a human-readable reason. */
  reason?: string;
}

export type PluginStatusKind =
  | "enabled" // loaded and active
  | "disabled" // installed, not active (user choice)
  | "incompatible" // manifest valid but core/ABI version mismatch
  | "error" // failed to load/validate — isolated, core unaffected
  | "untrusted"; // trust check required but failed/unsatisfied

export interface PluginStatus {
  kind: PluginStatusKind;
  /** True when the plugin module loaded without throwing. */
  loaded: boolean;
  /** Count of contributions (tools/commands/etc.) registered. */
  contributions?: number;
  /** Optional health detail. */
  detail?: string;
}

// ── What a plugin may contribute back to XR ────────────────────────────────────

/**
 * A command a plugin contributes. Invoked as `xr plugin <id> <command> ...`.
 * Kept intentionally narrow in 1.0 — argv in, the plugin prints via host.log.
 */
export interface PluginCommand {
  name: string;
  description?: string;
  run(argv: string[]): Promise<void> | void;
}

/**
 * A tool a plugin contributes. XR adapts this into a core Tool, namespaced and
 * approval-gated. The plugin tool runs with ONLY its granted host capabilities.
 */
export interface PluginTool {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  /** If true, XR will require human approval before each call. Default: true. */
  requiresApproval?: boolean;
  run(args: Record<string, unknown>): Promise<PluginToolResult> | PluginToolResult;
}

export interface PluginToolResult {
  ok: boolean;
  output: string;
  data?: unknown;
}

/** Declarative prompt/template contribution (data only, no code execution). */
export interface PluginPrompt {
  id: string;
  description?: string;
  template: string;
}

/**
 * The object a plugin's `register()` (or default export) returns to declare
 * what it contributes. Everything is optional; a plugin may contribute nothing
 * and still be valid (e.g. a pure lifecycle/automation plugin).
 */
export interface PluginContributions {
  commands?: PluginCommand[];
  tools?: PluginTool[];
  prompts?: PluginPrompt[];
  /** Optional teardown hook called on disable/unload. Must not throw. */
  dispose?(): void | Promise<void>;
}

/**
 * The shape XR expects from a plugin entry module. Either a default export that
 * is an activate function, or a named `activate` export. The function receives a
 * frozen host and returns its contributions.
 */
export type PluginActivate = (
  host: import("./host.ts").PluginHost,
) => PluginContributions | Promise<PluginContributions>;

export interface PluginModule {
  activate?: PluginActivate;
  default?: PluginActivate | { activate: PluginActivate };
}
