# 10 — Full Product Build Plan (build everything, now)
### XR · @ahmadrrrtx · 2026-06-03

Decision: build the **complete market-dominating product** now — not after launch.
Constraint that makes "everything" safe: **every feature routes through the existing
security spine** (approval gate · egress allow-list · policy · tamper-evident audit ·
localhost-only daemon). That's the difference between "full-featured" and "OpenClaw".

## Status so far (DONE ✅, 46 tests passing)
- P0 engine · P1 Cost Governor · P2 Local-Reliability · P3 Non-Regressive Skills · P4 Security Lab + Self-Heal

## Build order (each block fully tested before next)

### BLOCK 1 — Tools & live data (the agent can DO more)
- [ ] `web_search` (SearXNG, egress-gated) · `fetch_url` (HTML→clean text)
- [ ] `get_github`, `check_package` (npm/PyPI/crates), `read_docs`
- [ ] `shell` tool (sandboxed + approval + dangerous-cmd block)
- [ ] `list_dir`, `delete_file` (approval-gated)

### BLOCK 2 — Skills library (value on day 1)
- [ ] 10 pre-built signed skills (debug_error, write_tests, explain_codebase,
      security_audit, refactor_clean, generate_readme, git_commit_message,
      pr_description, api_design, db_migrate)

### BLOCK 3 — Trust UX (dry-run, estimates, open bench)
- [ ] `--dry-run` mode · cost-estimate-before-commit
- [ ] `xr test --attacks --json` signed report + open-sourced corpus
- [ ] task templates · task queue · session bookmarks

### BLOCK 4 — Memory & context (knows your codebase)
- [ ] local RAG (nomic-embed via Ollama) + codebase fingerprint
- [ ] project memory (cross-session) · smart context compaction

### BLOCK 5 — Daemon + Dashboard (localhost-only, the demo engine)
- [ ] `xr serve` daemon (127.0.0.1 + local token) · REST + WebSocket
- [ ] Dashboard panels: Live Console · Cost Cockpit · Audit Explorer ·
      Skills Library · Security Posture · File Workspace · Session History · Model Config

### BLOCK 6 — Mobile (Telegram, secure)
- [ ] bot + inline approval buttons · `/budget /pause /status` · task dispatch · daily digest

### BLOCK 7 — Voice (local, free)
- [ ] OpenWakeWord ("Hey XR") · Whisper.cpp STT · Kokoro TTS · barge-in · voice-confirm

### BLOCK 8 — Ecosystem & automation
- [ ] MCP client + server · cron scheduler (NL) · webhook outbound · VS Code extension (thin)

### BLOCK 9 — Polish
- [ ] Docker (single container) · signed installers · i18n · benchmark page · signed PDF export

## Non-negotiable guardrails (so "everything" stays safe)
1. Daemon binds 127.0.0.1 only, token-auth, opt-in.
2. Every state-change → approval gate + policy + audit.
3. All network tools → egress allow-list.
4. Keep deps minimal & audited; vendored where possible.
5. Test after every block; never break a green suite.
