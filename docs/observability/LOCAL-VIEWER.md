# Local Observability Viewer — no cloud, no account

XR telemetry is **local-first**: the default OTLP endpoint
(`http://127.0.0.1:4318`) is the standalone **.NET Aspire Dashboard** running
in Docker/Podman on your own machine. Nothing leaves localhost unless you
deliberately repoint the endpoint.

## 1. Start the viewer (one command)

```bash
docker run --rm -d \
  --name xr-observe \
  -p 18888:18888 \
  -p 4318:18890 \
  -e DOTNET_DASHBOARD_UNSECURED_ALLOW_ANONYMOUS=true \
  mcr.microsoft.com/dotnet/aspire-dashboard:latest
```

| Mapping | Purpose |
|---|---|
| `18888:18888` | dashboard UI → open <http://localhost:18888> |
| `4318:18890` | OTLP/HTTP ingest — matches XR's default `telemetry.endpoint` port 4318 |

Podman works identically (`podman run …`).

## 2. Enable XR telemetry

```bash
xr telemetry enable            # structural-only, redacted, localhost endpoint
xr telemetry status            # verify exactly what is captured
```

Every daemon request, routing decision, LLM call, tool execution and
isolation placement now appears in the dashboard — traces, structured/logs
(with `trace_id` correlation), and metrics.

## 3. Without telemetry enabled (always available)

These work **even with telemetry off** — they inspect local buffers only:

- `GET /api/v1/traces/recent` — bounded in-memory ring of recent spans (JSON)
- `GET /api/v1/metrics` — Prometheus text exposition of the live registry
- dashboard **System → health** surfaces the same readiness signal

## 4. Prometheus / Grafana instead

Point any Prometheus at the daemon:

```yaml
scrape_configs:
  - job_name: xr
    static_configs: [{ targets: ["127.0.0.1:7331"] }]
    bearer_token: <your local daemon token>
    metrics_path: /api/v1/metrics
```

(The endpoint requires the same local auth as every other API route — see
`docs/api/COMPATIBILITY.md`.)

## 5. Any other OTLP collector

Jaeger ≥ 1.35, the OpenTelemetry Collector, Grafana Tempo, etc. all accept
OTLP/HTTP JSON on their OTLP endpoints — just repoint:

```bash
xr telemetry enable --endpoint http://127.0.0.1:4318   # whatever your collector listens on
```

## 6. Privacy reminder

- Telemetry stays **opt-in**; `xr telemetry disable` stops everything and
  clears content opt-ins.
- Content (prompts/tool args) is **never** captured unless you pass
  `--content prompt|tool-args` — and the always-on redactor still applies.
- The viewer image runs locally; deleting the container deletes the data.

## 7. Hardening the viewer (optional)

The anonymous mode above is for single-user localhost. To require a browser
token instead, drop the env var and read the login token from
`docker logs xr-observe`. See the Aspire Dashboard standalone docs:
<https://learn.microsoft.com/dotnet/aspire/fundamentals/dashboard/standalone>
