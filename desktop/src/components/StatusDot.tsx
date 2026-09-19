/**
 * XR — honest status primitive (Phase 1 · audit D-07, design system §9).
 *
 * The audit found the status bar rendering a GREEN "Engine ● ollama" while the
 * engine's own `/providers` reported `healthy: false` with
 * "Unable to connect. Is the computer able to access the url?".
 *
 * The root cause was a missing state: the shell had ok / warn / danger, so
 * "we have not been told" collapsed into "ok". `unknown` is now first-class and
 * is deliberately grey — never green. Absence of evidence is not health.
 */

export type DotState = "ok" | "warn" | "danger" | "unknown" | "off";

const DOT_CLASS: Record<DotState, string> = {
  ok: "dot green",
  warn: "dot amber",
  danger: "dot red",
  unknown: "dot unknown",
  off: "dot unknown",
};

export function StatusDot({ state, title }: { state: DotState; title?: string }) {
  return (
    <i
      className={DOT_CLASS[state]}
      aria-hidden="true"
      data-state={state}
      {...(title ? { title } : {})}
    />
  );
}

/**
 * Map engine provider truth → a dot state.
 *
 * `healthy` is the engine's own probe result. `hasKey === false` on a hosted
 * provider means it can never work until the user connects it — that is
 * "off", not "unknown", because we know exactly what is wrong.
 */
export function providerDotState(p: {
  healthy?: boolean;
  hasKey?: boolean;
  authOk?: boolean;
  kind?: string;
} | undefined): DotState {
  if (!p) return "unknown";
  if (p.healthy === true) return "ok";
  if (p.healthy === false) {
    // Local runtime that is not running, or a hosted provider with no key:
    // both are "configured but not usable" → warn (actionable), not danger.
    if (p.kind === "local") return "warn";
    if (p.hasKey === false) return "off";
    return "warn";
  }
  return "unknown";
}

/** Concise, truthful label for the status bar. */
export function providerLabel(
  p: { id?: string; healthy?: boolean; kind?: string; hasKey?: boolean; detail?: string } | undefined,
): { text: string; detail: string; state: DotState } {
  const state = providerDotState(p);
  if (!p) return { text: "no provider", detail: "the engine has not reported a provider yet", state: "unknown" };
  const name = p.id ?? "provider";
  const kind = p.kind === "local" ? "local" : "cloud";
  switch (state) {
    case "ok":
      return { text: `${name} · ${kind}`, detail: `${name} is reachable`, state };
    case "warn":
      return {
        text: `${name} · offline`,
        detail: p.detail ?? `${name} is configured but not reachable`,
        state,
      };
    case "off":
      return {
        text: `${name} · no key`,
        detail: p.detail ?? `${name} has no credential stored — connect it in Settings → Models`,
        state,
      };
    default:
      return { text: `${name} · unknown`, detail: p.detail ?? "health has not been probed yet", state };
  }
}
