# XR 3.1.6 Repository Inventory

Generated: 2026-07-22T09:50:09.492Z

## Summary

| Area | Count |
|---|---:|
| Source files | 292 |
| Test files | 42 |
| CLI commands | 34 |
| Daemon routes | 52 |
| Providers | 26 |
| Local runtimes | 11 |
| Plugins | 2 |
| Skills | 65 |

## Entrypoints

- Package bin: `./bin/xr.cjs`
- Runtime CLI: `src/index.ts`
- Daemon: `src/daemon/server.ts`
- Docker entrypoint: `bun run src/index.ts serve --port 7842`

## CLI commands

- `shell` (start, stable) — xr [shell|--tui|tui]
- `serve` (start, stable) — xr serve [--port <n>]
- `onboarding` (start, supported) — xr onboarding
- `help` (start, stable) — xr help [topic|command]
- `version` (start, stable) — xr version | xr --version | xr -v
- `run` (work, supported) — xr run "<task>" [--mode agent|plan|ask] [--model p/m] [--budget usd]
- `ask` (work, supported) — xr ask "<question>" [--model p/m]
- `plan` (work, supported) — xr plan "<task>" [--model p/m]
- `research` (work, supported) — xr research "<topic>" [quick|deep|plan|status|setup]
- `agents` (work, supported) — xr agents [list|plan|run|status|stop|resume|inspect]
- `control` (work, supported) — xr control [status|start|stop|plan|setup|browser|…]
- `voice` (work, supported) — xr voice [setup|status|start|stop|test|devices|config]
- `speak` (work, supported) — xr speak <text>
- `listen` (work, supported) — xr listen
- `workspace` (context, supported) — xr workspace [list|create|use|switch|delete] …
- `session` (context, supported) — xr session [list|show|export] [id]
- `memory` (context, supported) — xr memory [list|add|search|recall|remove|health|export|…]
- `config` (context, supported) — xr config [get|set|path|reset] [key] [value]
- `providers` (intelligence, supported) — xr providers [list|set|add|remove|test|status|refresh]
- `models` (intelligence, supported) — xr models [status|list|recommend|install|remove|set|test|runtimes]
- `budget` (intelligence, supported) — xr budget [status|set|reset] [amount]
- `skills` (extensions, supported) — xr skills [list|search|install|enable|disable|inspect|doctor|…]
- `plugins` (extensions, supported) — xr plugins [list|search|install|enable|disable|remove|status]
- `mcp` (extensions, supported) — xr mcp [list|add|remove|enable|disable|tools|health|doctor]
- `shield` (trust, supported) — xr shield [status|scan|processes|startup|privacy|doctor|…]
- `audit` (trust, supported) — xr audit [tail|verify|export] [--limit n]
- `attacks` (trust, supported) — xr attacks [--json]
- `doctor` (system, supported) — xr doctor [--network] [--json] [--perf]
- `status` (system, supported) — xr status [--json] [--network]
- `update` (system, supported) — xr update [--yes]
- `repair` (system, supported) — xr repair [--yes] [--network]
- `reset` (system, supported) — xr reset [--hard] [--yes]
- `install` (system, supported) — xr install [--mode minimal|local|byok|hybrid|full] [--yes]
- `logs` (system, supported) — xr logs [--limit n] [--json]

## Daemon routes

- GET `/` — local bearer token or dashboard query token (src/daemon/routes/system.routes.ts)
- GET `/api/agents` — local bearer token or dashboard query token (src/daemon/routes/agents.routes.ts)
- GET `/api/agents/workflows/*` — local bearer token or dashboard query token (src/daemon/routes/agents.routes.ts)
- GET `/api/audit` — local bearer token or dashboard query token (src/daemon/routes/system.routes.ts)
- GET `/api/budget` — local bearer token or dashboard query token (src/daemon/routes/budget.routes.ts)
- POST `/api/budget/set` — local bearer token or dashboard query token (src/daemon/routes/budget.routes.ts)
- POST `/api/chat` — local bearer token or dashboard query token (src/daemon/routes/chat.routes.ts)
- GET `/api/config` — local bearer token or dashboard query token (src/daemon/routes/system.routes.ts)
- POST `/api/control/approve` — local bearer token or dashboard query token (src/daemon/routes/control.routes.ts)
- GET `/api/control/events` — local bearer token or dashboard query token (src/daemon/routes/control.routes.ts)
- GET `/api/control/history` — local bearer token or dashboard query token (src/daemon/routes/control.routes.ts)
- GET `/api/control/memory` — local bearer token or dashboard query token (src/daemon/routes/control.routes.ts)
- DELETE `/api/control/memory/*` — local bearer token or dashboard query token (src/daemon/routes/control.routes.ts)
- GET `/api/control/pending` — local bearer token or dashboard query token (src/daemon/routes/control.routes.ts)
- GET `/api/control/permissions` — local bearer token or dashboard query token (src/daemon/routes/control.routes.ts)
- POST `/api/control/plan` — local bearer token or dashboard query token (src/daemon/routes/control.routes.ts)
- GET `/api/control/status` — local bearer token or dashboard query token (src/daemon/routes/control.routes.ts)
- GET `/api/cost` — local bearer token or dashboard query token (src/daemon/routes/system.routes.ts)
- GET `/api/health` — open (src/daemon/routes/system.routes.ts)
- GET `/api/memory` — local bearer token or dashboard query token (src/daemon/routes/memory.routes.ts)
- DELETE `/api/memory/*` — local bearer token or dashboard query token (src/daemon/routes/memory.routes.ts)
- GET `/api/memory/health` — local bearer token or dashboard query token (src/daemon/routes/memory.routes.ts)
- GET `/api/memory/search` — local bearer token or dashboard query token (src/daemon/routes/memory.routes.ts)
- GET `/api/models` — local bearer token or dashboard query token (src/daemon/routes/providers.routes.ts)
- POST `/api/models/select` — local bearer token or dashboard query token (src/daemon/routes/providers.routes.ts)
- POST `/api/models/test` — local bearer token or dashboard query token (src/daemon/routes/providers.routes.ts)
- GET `/api/overview` — local bearer token or dashboard query token (src/daemon/routes/system.routes.ts)
- ANY `/api/plugins*` — local bearer token or dashboard query token (src/daemon/routes/extensions.routes.ts)
- GET `/api/providers` — local bearer token or dashboard query token (src/daemon/routes/providers.routes.ts)
- POST `/api/providers/set` — local bearer token or dashboard query token (src/daemon/routes/providers.routes.ts)
- GET `/api/research` — local bearer token or dashboard query token (src/daemon/routes/system.routes.ts)
- GET `/api/research/*` — local bearer token or dashboard query token (src/daemon/routes/system.routes.ts)
- GET `/api/security` — local bearer token or dashboard query token (src/daemon/routes/system.routes.ts)
- GET `/api/sessions` — local bearer token or dashboard query token (src/daemon/routes/system.routes.ts)
- GET `/api/sessions/*` — local bearer token or dashboard query token (src/daemon/routes/system.routes.ts)
- POST `/api/shield/adblock` — local bearer token or dashboard query token (src/daemon/routes/shield.routes.ts)
- GET `/api/shield/browser` — local bearer token or dashboard query token (src/daemon/routes/shield.routes.ts)
- GET `/api/shield/downloads` — local bearer token or dashboard query token (src/daemon/routes/shield.routes.ts)
- POST `/api/shield/explain` — local bearer token or dashboard query token (src/daemon/routes/shield.routes.ts)
- GET `/api/shield/privacy` — local bearer token or dashboard query token (src/daemon/routes/shield.routes.ts)
- GET `/api/shield/processes` — local bearer token or dashboard query token (src/daemon/routes/shield.routes.ts)
- POST `/api/shield/quarantine` — local bearer token or dashboard query token (src/daemon/routes/shield.routes.ts)
- GET `/api/shield/scan` — local bearer token or dashboard query token (src/daemon/routes/shield.routes.ts)
- GET `/api/shield/startup` — local bearer token or dashboard query token (src/daemon/routes/shield.routes.ts)
- GET `/api/shield/status` — local bearer token or dashboard query token (src/daemon/routes/shield.routes.ts)
- POST `/api/shield/whitelist` — local bearer token or dashboard query token (src/daemon/routes/shield.routes.ts)
- ANY `/api/skills*` — local bearer token or dashboard query token (src/daemon/routes/extensions.routes.ts)
- GET `/api/workspaces` — local bearer token or dashboard query token (src/daemon/routes/providers.routes.ts)
- POST `/api/workspaces/create` — local bearer token or dashboard query token (src/daemon/routes/providers.routes.ts)
- POST `/api/workspaces/switch` — local bearer token or dashboard query token (src/daemon/routes/providers.routes.ts)
- GET `/chat` — local bearer token or dashboard query token (src/daemon/routes/system.routes.ts)
- GET `/dashboard` — local bearer token or dashboard query token (src/daemon/routes/system.routes.ts)

## Providers and runtimes

- `ollama` — local, supported with local runtime
- `lmstudio` — local, supported with local runtime
- `jan` — local, supported with local runtime
- `localai` — local, supported with local runtime
- `vllm` — local, supported with local runtime
- `llamacpp` — local, supported with local runtime
- `gpt4all` — local, supported with local runtime
- `koboldcpp` — local, supported with local runtime
- `textgenwebui` — local, supported with local runtime
- `sglang` — local, supported with local runtime
- `groq` — hosted, supported with user-provided credentials
- `google` — hosted, supported with user-provided credentials
- `deepseek` — hosted, supported with user-provided credentials
- `cerebras` — hosted, supported with user-provided credentials
- `openrouter` — hosted, supported with user-provided credentials
- `together` — hosted, supported with user-provided credentials
- `mistral` — hosted, supported with user-provided credentials
- `fireworks` — hosted, supported with user-provided credentials
- `sambanova` — hosted, supported with user-provided credentials
- `huggingface` — hosted, supported with user-provided credentials
- `openai` — hosted, supported with user-provided credentials
- `anthropic` — hosted, supported with user-provided credentials
- `cohere` — hosted, supported with user-provided credentials
- `xai` — hosted, supported with user-provided credentials
- `perplexity` — hosted, supported with user-provided credentials
- `bedrock` — hosted, supported with user-provided credentials

## Plugins

- `github` — experimental plugin package
- `hello` — experimental plugin package

## Skills

- `academic_research` — supported content
- `api_design` — supported content
- `architecture_reviewer` — supported content
- `brand_designer` — supported content
- `code_auditor` — supported content
- `competitive_intelligence` — supported content
- `content_creator` — supported content
- `copywriter` — supported content
- `crm_assistant` — supported content
- `customer_support` — supported content
- `daily-brief` — supported content
- `db_migrate` — supported content
- `debug_error` — supported content
- `debugging_expert` — supported content
- `deep_research` — supported content
- `devops_engineer` — supported content
- `docker_expert` — supported content
- `email_writer` — supported content
- `explain_codebase` — supported content
- `financial_analyst` — supported content
- `full_stack_engineer` — supported content
- `generate_readme` — supported content
- `git_commit_message` — supported content
- `git_expert` — supported content
- `go_expert` — supported content
- `incident_response` — supported content
- `java_expert` — supported content
- `kubernetes_expert` — supported content
- `logo_designer` — supported content
- `malware_analyst` — supported content
- `market_research` — supported content
- `marketing_strategist` — supported content
- `negotiation_expert` — supported content
- `nextjs_expert` — supported content
- `node_expert` — supported content
- `osint_researcher` — supported content
- `paper_analyzer` — supported content
- `patent_research` — supported content
- `pentest_assistant` — supported content
- `performance_optimizer` — supported content
- `pr_description` — supported content
- `presentation_builder` — supported content
- `privacy_advisor` — supported content
- `product_manager` — supported content
- `project_manager` — supported content
- `proposal_writer` — supported content
- `python_expert` — supported content
- `react_expert` — supported content
- `refactor_clean` — supported content
- `refactoring_expert` — supported content
- `rust_expert` — supported content
- `sales_agent` — supported content
- `scientific_research` — supported content
- `security_audit` — supported content
- `seo_expert` — supported content
- `soc_analyst` — supported content
- `social_media_creator` — supported content
- `startup_advisor` — supported content
- `story_writer` — supported content
- `testing_expert` — supported content
- `threat_hunter` — supported content
- `ui_designer` — supported content
- `ux_designer` — supported content
- `video_script_writer` — supported content
- `write_tests` — supported content

Machine-readable inventory: `inventory.json`.
