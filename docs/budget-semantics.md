# Budget semantics: what the limits and `0` mean

This page is the single place that defines XR's spend limits (hardening B4–B6). Stored values are
not reinterpreted: the meanings below are what the code already did, now stated and enforced in the
places a user meets them.

| Limit | Set with | `0` means | Unset means |
|---|---|---|---|
| Monthly cap (`monthly_cap`) | `xr budget set <usd>`, `POST /api/budget/set`, dashboard, desktop | **Block every paid request** in the workspace. Local models still run. The API refuses `monthlyCap: 0` unless `confirmBlockAll: true` is sent; the dashboard and onboarding ask first, and the desktop's local-only mode (monthly limit 0) sends the confirmation | XR's **$10** safety default. `xr budget status`, `xr doctor` and onboarding say when the default is in force |
| Daily cap (`daily_cap`) | same | Block every paid request today (API only; the desktop and dashboard send `null` for "off") | No daily cap (`null`) |
| Per-task cap (`perTaskUsd`, `xr run --budget`) | config `budget.perTaskUsd`, run flag | **No per-task USD ceiling**; the monthly and daily caps still apply | $0.25 (config default) |

## Unpriced models stop as `unpriced`, not as a budget stop

XR never treats an unknown price as free. A model with neither shipped price facts
(`src/core/model-facts.json`) nor an operator-declared rate is refused before any request is sent,
and the run ends in its own state: `stopped: "unpriced"`, stream status `unpriced_stopped`,
`finishReason: "unpriced"`, and a task `fail` event carrying the refusal's own reason. Raising a
budget cannot fix it. Declare a rate under
`providerEngine.providerCapabilities.<provider>.models.<model>.cost` (`known`, `inPerMTok`,
`outPerMTok`, `source`) or pick a priced or local model.

## Stale price facts warn, they do not block

`model-facts.json` carries a review date (`staleAt`). After it, runs keep using the last-known
rates, so a calendar date never blocks paid providers. XR says so instead: a
`pricing.facts_stale` audit event on every governed request, a one-time warning in the run, and a
`Model price facts` warning in `xr doctor`. Operators who prefer refusal set
`XR_STALE_PRICE_FACTS=refuse`.
