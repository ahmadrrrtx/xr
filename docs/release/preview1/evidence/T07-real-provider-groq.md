# T07 / T21 — evidence: real-provider (Groq) smoke, plus two defects it exposed

Plan source: 3/D7 (live provider quality), 5 "Providers and BYOK". This is the first time the
real-provider path has run at all; the plan listed it as BLOCKED on a key. The owner supplied a
Groq key on 2026-11-10.

Budget spent on live calls: **$0.0002** (2.0k tokens), inside a `$0.05` cap. No other provider
was contacted.

## 1. The live run — PASS

```
$ XR_SECRETS_ENV_COMPAT=1 XR_HOME=…/xrhome-groq \
  bun run src/index.ts "Reply with exactly the token SMOKE-OK and nothing else." \
    --provider groq --model openai/gpt-oss-20b --budget 0.05
› Loaded AGENTS.md as project rules
SMOKE-OK
✓ 0 files changed · 0 commands completed successfully · 2.0k tok ≈ $0.0002 / $0.05 estimated admission threshold
exit=0
```

`xr doctor` agrees: `groq ✓ models endpoint OK (HTTP 200)`.

## 2. New defect T22.a (P1) — 23 of 26 provider presets cannot run a budgeted task, and the error says "raise your budget"

The budget governor refuses a request **before sending** when it cannot price the model
(`src/cost/governor.ts:146`, `src/core/model-accounting.ts:105`). "Unpriced is never free" is the
right security posture. But price facts exist for very few providers:

```
$ jq -r '.models[] | select(.price != null) | .providerId' src/core/model-facts.json | sort | uniq -c
      4 openai
      3 anthropic
      2 google
```

The other 23 presets (groq, deepseek, openrouter, together, fireworks, sambanova, xai,
perplexity, huggingface, cerebras, mistral, cohere, …) have **no** price facts, so every task
against them is refused at admission with, verbatim:

```
price unavailable: configure sourced/operator-declared rates or choose a known-priced/local model; no request sent
```

…which the CLI then replaced with a generic string that cannot help:

```
✕ budget limit reached (raise it in the desktop app or `xr run --budget`)
```

A user following that advice raises the cap forever and stays blocked.

### Fix (this commit)

- `src/core/agent.ts`: the budget stop now carries the governor's real reason in `finalMessage`
  (same line, no file growth — `size-gate` polices this file).
- `src/cli/coder/index.ts`: `describeStop` passes the reason through and gives advice that
  matches the cause. For an unpriced model it says raising the budget will not help and names the
  one thing that does: `providerEngine.providerCapabilities.<provider>.models.<model>.cost`
  (`known`, `inPerMTok`, `outPerMTok`, `source`).

Verified against the live condition:

```
✕ Stopped to respect your budget: price unavailable: configure sourced/operator-declared rates
  or choose a known-priced/local model; no request sent. 💰 0 tok (price unavailable) /
  $0.05 estimated admission threshold — raising the budget will not help. XR refuses to run a
  model it cannot price: declare the rate under providerEngine.providerCapabilities.<provider>
  .models.<model>.cost (known, inPerMTok, outPerMTok, source), or pick a known-priced or local model.
```

Tests: `test/cli/coder/routing-and-events.test.ts` — two new cases (unpriced reason is surfaced
and does not advise raising the budget; a genuine spent-ceiling stop still does). `test/cli` 262
pass, 0 fail.

### Still open (T21.b, P2 — not this week)

Adding sourced price facts for the other 23 presets is data work that needs a verified price per
model, provider by provider. Preview 1 ships the **working path** (operator-declared rates, now
documented in the error message) rather than a hastily-filled registry. One secondary source is
not enough to stamp a curated, dated price registry.

## 3. New defect T21.a (P1) — the Groq preset advertised models Groq no longer serves

```
$ curl -s https://api.groq.com/openai/v1/models        # live, 2026-11-10
allam-2-7b
canopylabs/orpheus-arabic-saudi
canopylabs/orpheus-v1-english
meta-llama/llama-prompt-guard-2-22m
meta-llama/llama-prompt-guard-2-86m
openai/gpt-oss-120b
openai/gpt-oss-20b
openai/gpt-oss-safeguard-20b
qwen/qwen3.8-27b
whisper-large-v3
whisper-large-v3-turbo
```

`src/providers/presets.ts` defaulted Groq to `llama-3.3-70b-versatile` and listed
`llama-3.1-8b-instant`, `mixtral-8x7b-32768`, `gemma2-9b-it` — none of which are served any more.
Selecting Groq out of the box therefore failed on the first request with
`Model llama-3.1-8b-instant not available on provider groq`.

The repo's own `docs/release/UI-REDESIGN-2026-10-29.md:167` already acknowledges this ("`llama-3.3-70b-versatile` is retired on Groq in 2026 … updating provider presets is a provider-catalog
change, out of this redesign's scope"). Preview 1 is where it has to be fixed, because it is the
first release that tells people to bring a Groq key.

### Fix (this commit)

`knownModels` replaced with the live catalogue verified above; `defaultModel` → `openai/gpt-oss-20b`.
Comment records the command and date used to verify, so the next person can re-check rather than
trust it.

Gates after the change: `npx tsc --noEmit` exit 0 · `test/providers` + `test/cli` 382 pass 0 fail ·
`claim-lint` ✓ · `size-gate` ✓ (tree at 99.9 % of ceiling) · `placeholder-lint` ✓.

### Residual

A fresh Groq user still hits the tariff gate (T22.a) until they declare a rate, because
`openai/gpt-oss-20b` has no price fact either. The two defects compound; the message now tells
them exactly what to do, and the operator-rate path is proven to work end to end (the run above).

## Credential handling

Both credentials supplied by the owner were placed in a `chmod 600` file outside the repository,
in a path excluded from workspace snapshots. Verified absent from the working tree, from all
commits on this branch, from git config and from the remote URL:

```
token in tracked files: 0      token in commits: 0      token in remote: 0
groq key in tracked files: 0   groq key in commits: 0
```

Nothing was printed. The token was used once, for a scope check that reads the
`X-OAuth-Scopes` response header only: `repo`, `workflow` (+ admin on this repo) — sufficient for
G1 and G3.
