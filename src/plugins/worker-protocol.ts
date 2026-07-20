/**
 * XR — Worker Plugin Sandbox Protocol
 *
 * Defines the message types and structures used for communication between
 * the main thread and the Worker-based plugin sandbox.
 *
 * PROTOCOL DESIGN:
 *  - All messages are typed discriminated unions for exhaustive matching
 *  - Capability requests use a request/response pattern with correlation IDs
 *  - Contributions are serialized as metadata (functions cannot cross threads)
 *  - Tool/command invocations use request/response with correlation IDs
 *  - Audit events are fire-and-forget (no response expected)
 */

import type { PermissionScope, PluginManifest } from "./types.ts";

// ── Main → Worker Messages ──────────────────────────────────────────────────

export interface WorkerInitMessage {
  type: "init";
  pluginDir: string;
  entryFile: string;
  manifest: PluginManifest;
  granted: PermissionScope[];
  /** Pre-loaded secret values (only names the plugin declared + was granted). */
  secrets: Record<string, string | undefined>;
  /** Egress allowlist for network filtering. */
  egressAllowlist: string[];
  /** MCP server declarations (metadata only). */
  mcpServers: Array<{
    id: string;
    transport: string;
    url?: string;
    tools: string[];
    description?: string;
  }>;
  /** XR core version string. */
  coreVersion: string;
  /** Plugin API version number. */
  apiVersion: number;
}

export interface WorkerActivateRequest {
  type: "activate-request";
}

export interface WorkerInvokeMessage {
  type: "invoke";
  requestId: string;
  kind: "tool" | "command";
  name: string;
  args: Record<string, unknown> | string[];
}

export interface WorkerDisposeMessage {
  type: "dispose";
}

export interface WorkerCapabilityResponse {
  type: "capability-response";
  requestId: string;
  result?: unknown;
  error?: string;
}

export type MainToWorkerMessage =
  | WorkerInitMessage
  | WorkerActivateRequest
  | WorkerInvokeMessage
  | WorkerDisposeMessage
  | WorkerCapabilityResponse;

// ── Worker → Main Messages ──────────────────────────────────────────────────

export interface WorkerReadyMessage {
  type: "ready";
}

export interface WorkerLoadedMessage {
  type: "loaded";
  ok: boolean;
  error?: string;
}

/**
 * Serialized contribution metadata. Functions cannot cross the thread boundary,
 * so we send only the metadata. The main thread creates proxy functions.
 */
export interface SerializedContributions {
  tools: Array<{
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
    requiresApproval?: boolean;
  }>;
  commands: Array<{
    name: string;
    description?: string;
  }>;
  prompts: Array<{
    id: string;
    description?: string;
    template: string;
  }>;
  hasDispose: boolean;
}

export interface WorkerActivatedMessage {
  type: "activated";
  ok: boolean;
  contributions?: SerializedContributions;
  error?: string;
}

export interface WorkerInvokedMessage {
  type: "invoked";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface WorkerDisposedMessage {
  type: "disposed";
}

/**
 * Capability request from the worker. The main thread must handle this
 * and send back a WorkerCapabilityResponse with the same requestId.
 */
export interface WorkerCapabilityRequest {
  type: "capability-request";
  requestId: string;
  capability: "memory" | "provider" | "audit";
  method: string;
  args: unknown[];
}

export interface WorkerLogMessage {
  type: "log";
  level: "log" | "warn" | "error" | "info" | "debug";
  message: string;
}

export interface WorkerErrorMessage {
  type: "error";
  message: string;
  fatal: boolean;
}

export type WorkerToMainMessage =
  | WorkerReadyMessage
  | WorkerLoadedMessage
  | WorkerActivatedMessage
  | WorkerInvokedMessage
  | WorkerDisposedMessage
  | WorkerCapabilityRequest
  | WorkerLogMessage
  | WorkerErrorMessage;

// ── Timeout Constants ───────────────────────────────────────────────────────

/** Timeout for plugin activation (activate() call). */
export const ACTIVATE_TIMEOUT_MS = 30_000;

/** Timeout for tool/command invocations. */
export const INVOKE_TIMEOUT_MS = 15_000;

/** Timeout for capability requests (memory, provider). */
export const CAPABILITY_TIMEOUT_MS = 30_000;

/** Timeout for worker initialization (loading + VM setup). */
export const INIT_TIMEOUT_MS = 10_000;
