# XR 4.4 — User Guide (Automatic Intelligence)

## What you get

XR can pick a suitable model for a task using:

- what the task needs (chat, tools, vision, …)
- your privacy settings (local-only, etc.)
- cost and speed preferences
- which providers you have configured
- optional past success stats (when enough data exists)

You always keep full manual control.

## Everyday use

Most users change nothing. Your existing default provider still works.

See what XR would choose:

```bash
xr providers status
xr providers route
```

Detailed breakdown:

```bash
xr providers explain
xr providers explain --json
```

## Pin a provider or model

```bash
xr providers set ollama qwen2.5:7b
xr providers set openai gpt-4o-mini
```

Pins are never silently replaced. If a pin is unavailable, XR only falls back when fallback is allowed.

## Local-only (privacy)

Ensure sensitive work stays on-machine:

```json
{
  "localModels": { "routing": "local-only" }
}
```

or

```json
{
  "intelligencePlane": {
    "mode": "local_only",
    "localityPolicy": "local_only",
    "allowCloudFallback": false
  }
}
```

A cheaper cloud model will **not** be used for local-only tasks.

## Prefer cheap or fast

```json
{
  "providerEngine": { "routingStrategy": "cheapest" }
}
```

```json
{
  "intelligencePlane": { "mode": "latency_constrained" }
}
```

## Fallback

When the primary model fails (outage, rate limit, invalid response), XR may try the next compatible model in the fallback chain — **without** sending local-only data to the cloud unless you set `allowCloudFallback: true`.

If nothing safe remains, XR stops and asks you to intervene.

## Reading a route explanation

Normal mode shows:

- selected provider/model
- local vs cloud
- short “why”
- fallback if configured

Advanced (`explain` / `--json`) adds scores, rejected candidates, and constraints.

## Disable automatic routing

```json
{
  "intelligencePlane": { "mode": "manual" }
}
```

Then only your explicit defaults/pins are used.
