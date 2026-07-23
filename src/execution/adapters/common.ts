/**
 * XR 4.1 — Adapter utilities.
 *
 * Shared helpers used by every execution adapter: id generation, safe
 * stringification, redaction of obvious secrets, size estimation.
 */
import { randomUUID } from "node:crypto";
import type {
  ActorIdentity,
  CapabilityIdentity,
  ExecutionObservation,
  IdempotencyClass,
  Placement,
} from "../types.ts";
import { EXECUTION_BOUNDS } from "../types.ts";

export function newRunId(): string {
  return `ex_${randomUUID().slice(0, 10)}`;
}

export function newCorrelationId(): string {
  return `cor_${randomUUID().slice(0, 10)}`;
}

export function newRequestId(): string {
  return `apr_${randomUUID().slice(0, 8)}`;
}

/** Redact obvious secrets (same pattern as WorkspaceStore.redact). */
export function redact(input: string): string {
  return input
    .replace(/(sk-[A-Za-z0-9]{8,})/g, "«redacted»")
    .replace(/(Bearer\s+[A-Za-z0-9._-]{8,})/g, "Bearer «redacted»")
    .replace(/(xox[baprs]-[A-Za-z0-9-]{10,})/g, "«redacted»")
    .replace(/(api[_-]?key["':=\s]+[A-Za-z0-9._-]{8,})/gi, "api_key=«redacted»");
}

/** Safe JSON stringify with truncation. */
export function safeJson(obj: unknown, maxChars = EXECUTION_BOUNDS.MAX_INPUT_SUMMARY_CHARS): string {
  try {
    const s = JSON.stringify(obj) ?? "";
    return s.length > maxChars ? s.slice(0, maxChars - 16) + "…<truncated>" : s;
  } catch {
    return "<unserializable>";
  }
}

/** Approximate input size in bytes (UTF-16 safe-ish). */
export function sizeBytes(s: string | undefined | null): number | undefined {
  if (!s) return undefined;
  return Buffer.byteLength(s, "utf8");
}

/** Default in-process placement for Phase 2. */
export const IN_PROCESS_PLACEMENT: Placement = { kind: "in_process", description: "Phase 2 local execution" };

/** Success observation factory. */
export function okObservation(summary: string, opts: Partial<ExecutionObservation> = {}): ExecutionObservation {
  return {
    summary: summary.slice(0, EXECUTION_BOUNDS.MAX_OBSERVATION_SUMMARY_CHARS),
    transportOk: true,
    ...opts,
  };
}

/** Failure observation factory. */
export function failObservation(summary: string, opts: Partial<ExecutionObservation> = {}): ExecutionObservation {
  return {
    summary: summary.slice(0, EXECUTION_BOUNDS.MAX_OBSERVATION_SUMMARY_CHARS),
    transportOk: false,
    ...opts,
  };
}

/** Infer idempotency class from capability identity (conservative defaults). */
export function defaultIdempotency(cap: CapabilityIdentity): IdempotencyClass {
  if (cap.kind === "model_call") return "non_idempotent";
  if (cap.kind === "core_tool") {
    switch (cap.name) {
      case "read_file":
      case "list_dir":
      case "check_package":
      case "fetch_url":
      case "web_search":
      case "system_apps":
      case "system_clipboard_read":
      case "system_volume":
      case "system_screenshot":
      case "system_battery":
      case "system_wifi":
        return "naturally_idempotent";
      case "write_file":
      case "delete_file":
      case "shell":
        return "idempotent_with_key";
      default:
        return "unknown_unsafe";
    }
  }
  if (cap.kind === "control_action") return "unknown_unsafe";
  if (cap.kind === "mcp_resource" || cap.kind === "mcp_prompt") return "naturally_idempotent";
  if (cap.kind === "mcp_tool") return "unknown_unsafe";
  if (cap.kind === "plugin_operation") return "unknown_unsafe";
  if (cap.kind === "skill_operation") return "unknown_unsafe";
  if (cap.kind === "workflow_task") return "non_idempotent";
  if (cap.kind === "research_operation") return "idempotent_with_key";
  if (cap.kind === "business_action") return "unknown_unsafe";
  return "unknown_unsafe";
}

/** Build a simple agent actor. */
export function agentActor(agentId: string, providerId: string, model?: string): ActorIdentity {
  return { kind: "agent", agentId, providerId, model };
}

export function userActor(source: "cli" | "tui" | "daemon" | "telegram" | "api" | string): ActorIdentity {
  return { kind: "user", source: source as "cli" | "tui" | "daemon" | "telegram" | "api" };
}

export function systemActor(component: string): ActorIdentity {
  return { kind: "system", component };
}
