/**
 * XR Phase 12 · Phase C — canonical UX status vocabulary.
 *
 * ONE CORE. ONE IDENTITY. ONE STATE MODEL. MANY INTERFACES.
 *
 * Before this module the three interactive surfaces each invented their own
 * description of the same run:
 *
 *   · the loop emitted exactly three free-form strings
 *     (`provider_selection`, `provider_ready`, `cancelled`) into an
 *     unconstrained `status: string` field;
 *   · the Shell hardcoded its own labels in `busyLabel`
 *     ("connecting to X", "planning", "reading", "thinking");
 *   · the Control Center dropped every status except the two provider ones.
 *
 * The same run therefore read differently depending on which window you looked
 * through. This module is the single source of truth for what XR is doing, so
 * every surface renders the same vocabulary from the same ids.
 *
 * HONESTY CONTRACT (brief §7 — "Do not fake progress"):
 *
 * Every status declared here is emitted from a real, verified point in the
 * execution path, or is an existing XR execution state that surfaces already
 * have to render (see `src/execution/inspection.ts` / `state-machine.ts`).
 * A status with no emission point is not declared here. In particular the
 * brief's "Searching web", "Reading source", "Retrying" and "Switching
 * provider" are deliberately ABSENT: no such event is produced on the
 * streaming path today, and inventing a label for an event that never fires
 * would be exactly the fake progress this file exists to prevent.
 *
 * LAYERING: this module has **zero imports** so it stays inside the L0 kernel
 * (`kernel-stays-kernel`, .dependency-cruiser.cjs). It defines *semantics*
 * only — ids, user-facing labels and a neutral tone. Colours belong to the
 * surfaces (`src/ui/tokens.ts`, dashboard CSS vars), never here.
 */

/**
 * Canonical run-lifecycle status ids.
 *
 * Emission points (all verified against `cc37607`):
 *   preparing            src/interfaces/shell/app.ts — provider build + health pre-flight
 *                        (deliberately NOT emitted by the chat route: preflight and
 *                        lane acquisition complete BEFORE the SSE stream opens, so a
 *                        "preparing" event there would describe work the client can
 *                        never observe. The route's immediate `provider_selection`
 *                        ack is the honest first event.)
 *   provider_selection   src/daemon/routes/chat.routes.ts — routing decision published
 *   provider_ready       src/core/agent.ts — provider resolved for the loop
 *   generating           src/core/agent.ts — a model turn is in flight
 *   tool_running         src/core/agent.ts — a tool call has been dispatched
 *   compacting_context   src/core/agent.ts — history compaction running
 *   budget_stopped       src/core/agent.ts — spend governor stopped the run
 *   finishing            src/core/agent.ts — summary + session close after the last token
 *   cancelled            src/daemon/routes/chat.routes.ts — cooperative cancel observed
 *   awaiting_approval    src/execution/state-machine.ts — capability awaiting a human decision
 *   done / error         terminal; mirrored from the `done` / `error` event types
 */
export const RUN_STATUSES = [
  "preparing",
  "provider_selection",
  "provider_ready",
  "generating",
  "tool_running",
  "compacting_context",
  "awaiting_approval",
  "budget_stopped",
  "cancelled",
  "finishing",
  "done",
  "error",
] as const;

/** A canonical run status id. */
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * Neutral tone. Surfaces map this onto their own palette (ANSI colours in the
 * TUI, CSS variables in the Control Center) — the kernel never names a colour.
 *
 *   idle    nothing in flight
 *   active  XR is working; expect further events
 *   wait    blocked on a human or a gate; no progress until it clears
 *   ok      succeeded
 *   warn    stopped or interrupted, but not a failure
 *   error   failed
 */
export type StatusTone = "idle" | "active" | "wait" | "ok" | "warn" | "error";

/** Tone per status — drives spinner/colour/live-region urgency on each surface. */
export const RUN_STATUS_TONE: Record<RunStatus, StatusTone> = {
  preparing: "active",
  provider_selection: "active",
  provider_ready: "active",
  generating: "active",
  tool_running: "active",
  compacting_context: "active",
  awaiting_approval: "wait",
  budget_stopped: "warn",
  cancelled: "warn",
  finishing: "active",
  done: "ok",
  error: "error",
};

/**
 * Shared user-facing label — the shared terminology of brief §4. Every surface
 * shows these words for the same state, so "Waiting for approval" means the
 * same thing in the CLI, the Shell and the Control Center.
 */
export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  preparing: "Preparing",
  provider_selection: "Selecting provider",
  provider_ready: "Provider ready",
  generating: "Generating",
  tool_running: "Running tool",
  compacting_context: "Compacting context",
  awaiting_approval: "Waiting for approval",
  budget_stopped: "Stopped by budget",
  cancelled: "Cancelled",
  finishing: "Finishing",
  done: "Done",
  error: "Error",
};

/** Statuses after which no further progress events will arrive. */
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ["done", "error"];

/** Statuses that mean "XR is doing something right now" (drive the spinner). */
export function isActiveRunStatus(status: string): boolean {
  return RUN_STATUS_TONE[status as RunStatus] === "active";
}

/** True for `done` / `error`. */
export function isTerminalRunStatus(status: string): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

/** Is `value` a status this vocabulary knows? */
export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && value in RUN_STATUS_TONE;
}

/**
 * Label for a status, tolerant of unknown ids.
 *
 * Surfaces receive status strings over a wire that is deliberately loose
 * (legacy pre-Phase-05 consumers still send free-form labels), so an unknown id
 * must degrade to something truthful and readable rather than throwing or
 * rendering `undefined`. Humanising an unknown id is honest: it shows what the
 * runtime actually said instead of hiding it.
 *
 * `detail` appends real context when the caller has it (e.g. the tool name),
 * so the surface never has to guess or fabricate one.
 */
export function runStatusLabel(status: string, detail?: string): string {
  const base = isRunStatus(status)
    ? RUN_STATUS_LABEL[status]
    : humanizeStatus(status);
  return detail ? `${base} · ${detail}` : base;
}

/** Tone for a status; unknown ids are treated as `active` (something is happening). */
export function runStatusTone(status: string): StatusTone {
  return isRunStatus(status) ? RUN_STATUS_TONE[status] : "active";
}

/** `provider_ready` → `Provider ready`. Used only for unknown/legacy ids. */
function humanizeStatus(status: string): string {
  const s = String(status ?? "").trim();
  if (!s) return "Working";
  const spaced = s.replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The vocabulary as a JavaScript object literal, for interpolation into the
 * served Control Center client.
 *
 * The dashboard client is a concatenated template-literal string served as
 * `/assets/dashboard.js` (see `src/daemon/dashboard/client-script.ts`); it
 * cannot `import` this module. Interpolating the single source of truth is the
 * established pattern — `src/daemon/dashboard/style-tokens.ts` does exactly
 * this for `COLOR` — and it is what stops the browser copy drifting from the
 * kernel copy.
 *
 * Emitted as JSON (a valid JS object literal) so no identifier can ever break
 * the served script.
 */
export const UX_STATUS_JS: string = `var XR_RUN_STATUS_LABEL = ${JSON.stringify(
  RUN_STATUS_LABEL,
)};\nvar XR_RUN_STATUS_TONE = ${JSON.stringify(
  RUN_STATUS_TONE,
)};\nfunction xrStatusLabel(status, detail) {\n  var base = Object.prototype.hasOwnProperty.call(XR_RUN_STATUS_LABEL, status)\n    ? XR_RUN_STATUS_LABEL[status]\n    : String(status || "Working").replace(/[_-]+/g, " ").replace(/^./, function (c) { return c.toUpperCase(); });\n  return detail ? base + " \\u00b7 " + detail : base;\n}\nfunction xrStatusTone(status) {\n  return Object.prototype.hasOwnProperty.call(XR_RUN_STATUS_TONE, status) ? XR_RUN_STATUS_TONE[status] : "active";\n}\n`;
