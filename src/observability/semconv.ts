/**
 * Semantic-convention attribute names (Phase 8 · T2).
 *
 * GenAI names follow the OpenTelemetry GenAI semantic conventions
 * (docs/historical/phases/phase8/03-RESEARCH-NOTES.md · R1): span names are
 * `{operation} {name}` (`chat <model>`, `execute_tool <tool>`,
 * `invoke_agent <agent>`); attributes are the structural set — content is
 * opt-in only, per the conventions themselves and Art. XXI.
 */

export const GENAI = {
  OPERATION_NAME: "gen_ai.operation.name",
  /** Successor name (current conventions). */
  PROVIDER_NAME: "gen_ai.provider.name",
  /** Legacy name kept alongside for backend interop (same value). */
  SYSTEM: "gen_ai.system",
  REQUEST_MODEL: "gen_ai.request.model",
  USAGE_INPUT_TOKENS: "gen_ai.usage.input_tokens",
  USAGE_OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
  RESPONSE_FINISH_REASONS: "gen_ai.response.finish_reasons",
  AGENT_NAME: "gen_ai.agent.name",
  AGENT_ID: "gen_ai.agent.id",
  TOOL_NAME: "gen_ai.tool.name",
  TOOL_TYPE: "gen_ai.tool.type",
  CONVERSATION_ID: "gen_ai.conversation.id",
  /** Content — only ever set under an explicit telemetry.content.* opt-in. */
  CONTENT_PROMPT: "gen_ai.content.prompt",
  CLIENT_OPERATION_DURATION: "gen_ai.client.operation.duration",
} as const;

export const HTTP = {
  METHOD: "http.request.method",
  ROUTE: "http.route",
  STATUS_CODE: "http.response.status_code",
  URL_PATH: "url.path",
} as const;

export const XR_ATTR = {
  RUN_ID: "xr.run.id",
  CORRELATION_ID: "xr.correlation.id",
  WORKSPACE_ID: "xr.workspace.id",
  CAPABILITY_KIND: "xr.capability.kind",
  ROUTING_REASON: "xr.routing.reason",
  ROUTING_UNAVAILABLE: "xr.routing.unavailable",
  PLACEMENT_TIER: "xr.placement.tier",
  PLACEMENT_BACKEND: "xr.placement.backend",
  PLACEMENT_BLOCKED: "xr.placement.blocked",
  API_MOUNT: "xr.api.mount", // v1 | legacy | surface
  OUTCOME: "xr.outcome",
} as const;

/** Span kinds (OTel-compatible vocabulary). */
export type SpanKind = "server" | "client" | "internal" | "producer" | "consumer";

export const SERVICE_ATTRS = {
  SERVICE_NAME: "service.name",
  SERVICE_VERSION: "service.version",
  TELEMETRY_SDK: "telemetry.sdk.name",
} as const;
