/**
 * XR Observability — instrumentation helpers (Phase 8 · T2).
 *
 * Standard span factories for the canonical surfaces: HTTP server spans,
 * GenAI `chat` spans, `execute_tool` spans, `invoke_agent` spans, routing
 * decisions, and isolation placements. Names follow the OTel GenAI
 * conventions (`{operation} {name}`); attributes are STRUCTURAL ONLY unless
 * an explicit `telemetry.content.*` opt-in flag is set — and even then
 * everything passes the redactor (set() in Span enforces this).
 */

import { startSpan, type Span } from "./tracer.ts";
import { GENAI, HTTP, XR_ATTR } from "./semconv.ts";
import { telemetry } from "./config.ts";
import { truncateValue } from "./redaction.ts";

// ── HTTP server spans (daemon) ───────────────────────────────────────────────

export function httpServerSpan(input: {
  routeId: string;
  method: string;
  path: string;
  mount: "v1" | "legacy" | "surface";
}): Span {
  const span = startSpan(`${input.method} ${input.path}`, { kind: "server", attributes: {} });
  span.set(HTTP.METHOD, input.method);
  span.set(HTTP.ROUTE, input.routeId);
  span.set(HTTP.URL_PATH, input.path);
  span.set(XR_ATTR.API_MOUNT, input.mount);
  return span;
}

export function endHttpServerSpan(span: Span, status: number): void {
  span.set(HTTP.STATUS_CODE, status);
  if (status >= 500) span.setStatus("error", `http_${status}`);
  else span.setStatus("ok");
  if (!span.isEnded()) span.end();
}

// ── GenAI spans (chat / tool / agent) ────────────────────────────────────────

export interface ChatSpanInput {
  model: string;
  provider: string;
  conversationId?: string;
  /** Opt-in content (telemetry.content.prompt). Redacted + truncated always. */
  prompt?: string;
}

export function chatSpan(input: ChatSpanInput): Span {
  const span = startSpan(`chat ${input.model}`, { kind: "client" });
  span.set(GENAI.OPERATION_NAME, "chat");
  span.set(GENAI.PROVIDER_NAME, input.provider);
  span.set(GENAI.SYSTEM, input.provider);
  span.set(GENAI.REQUEST_MODEL, input.model);
  if (input.conversationId) span.set(GENAI.CONVERSATION_ID, input.conversationId);
  if (telemetry().content.prompt && input.prompt) {
    span.set(GENAI.CONTENT_PROMPT, truncateValue(input.prompt));
  }
  return span;
}

export function endChatSpan(span: Span, result: {
  ok?: boolean;
  inTokens?: number;
  outTokens?: number;
  finishReason?: string;
  errorType?: string;
}): void {
  if (result.inTokens !== undefined) span.set(GENAI.USAGE_INPUT_TOKENS, result.inTokens);
  if (result.outTokens !== undefined) span.set(GENAI.USAGE_OUTPUT_TOKENS, result.outTokens);
  if (result.finishReason) span.set(GENAI.RESPONSE_FINISH_REASONS, [result.finishReason]);
  if (result.ok === false || result.errorType) span.setStatus("error", result.errorType ?? "llm_error");
  else span.setStatus("ok");
  if (!span.isEnded()) span.end();
}

export function toolSpan(input: { name: string; type?: string }): Span {
  const span = startSpan(`execute_tool ${input.name}`, { kind: "internal" });
  span.set(GENAI.OPERATION_NAME, "execute_tool");
  span.set(GENAI.TOOL_NAME, input.name);
  if (input.type) span.set(GENAI.TOOL_TYPE, input.type);
  return span;
}

export function agentSpan(input: { name: string; id?: string }): Span {
  const span = startSpan(`invoke_agent ${input.name}`, { kind: "internal" });
  span.set(GENAI.OPERATION_NAME, "invoke_agent");
  span.set(GENAI.AGENT_NAME, input.name);
  if (input.id) span.set(GENAI.AGENT_ID, input.id);
  return span;
}

/** Envelope span for the canonical execution path (capability execution). */
export function envelopeSpan(input: {
  capabilityKind: string;
  capabilityName: string;
  runId?: string;
  correlationId?: string;
  workspaceId?: string;
}): Span {
  const isModel = input.capabilityKind === "model_call";
  const span = isModel
    ? chatSpan({ model: input.capabilityName, provider: "xr" })
    : input.capabilityKind === "core_tool" || input.capabilityKind === "mcp_tool"
      ? toolSpan({ name: input.capabilityName, type: input.capabilityKind === "mcp_tool" ? "mcp" : "function" })
      : input.capabilityKind === "agent"
        ? agentSpan({ name: input.capabilityName })
        : startSpan(`execute ${input.capabilityKind} ${input.capabilityName}`, { kind: "internal" });
  if (!(input.capabilityKind === "model_call" || input.capabilityKind === "core_tool" || input.capabilityKind === "mcp_tool" || input.capabilityKind === "agent")) {
    span.set(XR_ATTR.CAPABILITY_KIND, input.capabilityKind);
  }
  if (input.runId) span.set(XR_ATTR.RUN_ID, input.runId);
  if (input.correlationId) span.set(XR_ATTR.CORRELATION_ID, input.correlationId);
  if (input.workspaceId) span.set(XR_ATTR.WORKSPACE_ID, input.workspaceId);
  return span;
}

// ── Routing / placement spans ────────────────────────────────────────────────

export function routingSpan(): Span {
  return startSpan("xr.routing.select", { kind: "internal" });
}

export function endRoutingSpan(span: Span, result: {
  provider?: string;
  model?: string;
  reason?: string;
  unavailable?: boolean;
  selectionMs?: number;
}): void {
  if (result.provider) span.set(GENAI.PROVIDER_NAME, result.provider);
  if (result.model) span.set(GENAI.REQUEST_MODEL, result.model);
  if (result.reason) span.set(XR_ATTR.ROUTING_REASON, result.reason);
  if (result.unavailable) span.set(XR_ATTR.ROUTING_UNAVAILABLE, true);
  span.setStatus(result.unavailable ? "error" : "ok", result.unavailable ? "no_route" : undefined);
  if (!span.isEnded()) span.end();
}

export function placementSpan(input: { tier?: string }): Span {
  const span = startSpan("xr.isolation.place", { kind: "internal" });
  if (input.tier) span.set(XR_ATTR.PLACEMENT_TIER, input.tier);
  return span;
}

export function endPlacementSpan(span: Span, result: {
  placement?: string;
  backend?: string;
  blocked?: boolean;
  reason?: string;
}): void {
  if (result.placement) span.set(XR_ATTR.PLACEMENT_TIER, result.placement);
  if (result.backend) span.set(XR_ATTR.PLACEMENT_BACKEND, result.backend);
  if (result.blocked) {
    span.set(XR_ATTR.PLACEMENT_BLOCKED, true);
    if (result.reason) span.set(XR_ATTR.OUTCOME, result.reason);
    span.setStatus("error", "placement_blocked");
  } else {
    span.setStatus("ok");
  }
  if (!span.isEnded()) span.end();
}
