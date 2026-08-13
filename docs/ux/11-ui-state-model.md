# 11 — UI State Model

**Date:** 2026-08-13. Every component must render every state honestly, fed
by real runtime data. States: **loading · empty · success · error · offline ·
permission-denied · requires-network · cancelled · (experimental/disabled)**.

## 1. The state contract (per component)

```
state = {
  status: "loading" | "empty" | "ready" | "error" | "offline" | "denied" | "cancelled",
  data?: any,           // real payload from API/CLI
  error?: { title, detail, action? },   // honest, actionable
  meta?: { locality, cost?, context?, ts }
}
```
Rules:
1. Never render `ready` from stale/absent data. Loading must show a spinner
   or skeleton ≤ 250 ms then data.
2. Empty ≠ error: explain *what* and *one next action*.
3. Error states: WHAT happened / WHY (real reason from runtime) / NEXT (a
   button or command). Never "Something went wrong" alone.
4. Offline ≠ broken: green locality badge, local features usable,
   network features show "requires network" + retry.
5. Permission denied: explain the denial came from the runtime policy gate
   and how to allow (config/approval).
6. Cancelled: honest `cancelled` outcome (runtime semantics) with resume
   path where supported.
7. Experimental/planned features: visibly labeled; never pretend to work.

## 2. Per-surface state matrix (implementation checklist)

| Surface | loading | empty | success | error | offline | denied | cancelled |
|---|---|---|---|---|---|---|---|
| Chat stream | streaming cursor + state line | avatar + suggested prompts | message + tool cards | inline error + retry | local-capable notice | tool denied card | "Stopped by you" + resume |
| Provider test | spinner on Test | "no providers yet" + Add | green "Connected · <latency>" | red reason + fix hint | "offline — cannot test" | key invalid (401 honest) | — |
| Local model pull | progressbar + size + speed | "no models installed" + recommend | "Ready · <model>" + verify | disk/network error + retry | download paused, resume | — | "cancelled" + partial cleanup |
| Memory | spinner | "XR remembers nothing yet" + how | list + undo | read error | still local ✓ | excluded entry (consent) | — |
| Approvals | — | "No pending authorizations" | Allow/Deny applied toast | API error | offline — queued or denied fail-closed | — | auto-denied on cancel |
| Audit | verifying… | "no events" | chain ✓ (green) | chain broken (red, exact entry) | verify still works offline ✓ | — | — |
| Budget | loading meter | "no budget set — set a cap?" | meter + remaining | fetch error | local spend still counts | — | budget stop (honest) |
| Skills/MCP/Plugins | spinner | "nothing installed — Add capability" | cards + health | install error + reason | offline registry | permission denied (manifest) | install cancelled |
| Voice (Phase E) | probing backends | "no STT/TTS configured" | Ready (real) | mic error | offline path note | mic permission denied | stop pressed |
| Dashboard overview | skeletons | — | bento cells real | per-cell error badge | locality badges | — | — |
| TUI equivalents | spinner frames | banner + hints | output | inline error + hint | same badge | approval overlay | interrupted ✓ |

## 3. Connectivity model (mission §26)

One source of truth: `probeHealth()` (used by doctor/onboarding/status) +
`/api/system`. Derived display state:

| Runtime truth | UI badge | Behavior |
|---|---|---|
| local model reachable + active | **LOCAL** (green) | full chat, files, memory, research offline |
| BYOK provider configured + reachable | **CLOUD · <provider>** (amber) | network features on; budget visible |
| provider down / no key | **SETUP REQUIRED** (amber) | readiness banner with the one action (exists) |
| no internet + cloud-only config | **OFFLINE** (neutral) | explain + suggest local model path |
| degraded (e.g., voice mic missing) | **DEGRADED** (amber) | list what's unavailable + why |

## 4. Permission/security states (mission §18)

| State | Visual | Backing |
|---|---|---|
| SAFE | green badge/icon | policy gate evaluated, no approval needed |
| REQUIRES APPROVAL | amber + card (WHAT/WHY/RISK) | pending in approval store |
| BLOCKED | red | policy denied / budget stop / egress block |
| UNKNOWN | neutral + "why" tooltip | capability probe returned no verdict (honest) |
| TRUSTED / UNVERIFIED (skills/plugins) | badge | manifest hashes + cert state |

## 5. Live-update rules

- Dashboard polls/SSE only what changes; no full-page reload loops.
- Tool timeline updates in place; chat streams via existing SSE
  (`data:{text}` / `[DONE]`).
- TUI repaints only dirty rows (already the design; keep).
