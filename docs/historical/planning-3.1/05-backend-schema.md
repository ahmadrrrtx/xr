# 05 — Backend / Data Schema
### SENTINEL · v1.0 · 2026-06-03

Local-first. **SQLite** (via Drizzle ORM) for queryable/transactional state; **files** for human-editable artifacts (config, skills, memory docs); **OS keychain** for secrets.

---

## 1. On-disk layout
```
~/.sentinel/
├── config.toml                # human-editable, schema-validated, versioned
├── sentinel.db                # SQLite: sessions, steps, cost, skills, audit
├── providers/                 # declarative provider manifests
│   ├── openai.json
│   ├── groq.json
│   ├── ollama.json
│   └── <custom>.json
├── memory/                    # 3-tier, human-readable markdown
│   ├── identity.md            # L1: who the user is, the agent's "soul"
│   ├── strategic.md           # L2: goals, projects, style
│   └── operational/           # L3: playbooks, daily logs
│       └── 2026-06-03.md
├── skills/                    # signed markdown SOPs
│   ├── daily-brief/
│   │   ├── SKILL.md
│   │   ├── tools.json         # tool allow-list for this skill
│   │   └── SKILL.sig          # signature
│   └── ...
├── snapshots/                 # git repo: file-change history (undo/time-travel)
└── versions/                  # installed versions (transactional updates)
    ├── 1.0.2/
    └── 1.0.3/  -> (current symlink)
```

Secrets: **never on disk in plaintext** — stored in OS keychain keyed by provider id.

## 2. config.toml (schema, Zod-validated)
```toml
version = 3

[defaults]
mode = "agent"            # agent | plan | ask
cheap_model = "ollama:qwen3.6:7b"
smart_model = "groq:llama-3.3-70b"

[budget]
per_task_usd = 0.25
per_task_tokens = 250000
compress_every = 3
early_stop_no_progress = 4   # halt after N no-progress steps

[security]
egress_allowlist = ["api.github.com", "dev.to"]
sandbox = "docker"           # none | docker | wasm
require_approval = ["write_file","delete","shell","send","create_key","financial"]

[providers]                  # which manifests are active; keys live in keychain
active = ["ollama","groq"]
```

## 3. SQLite schema (Drizzle)

```sql
-- A unit of work
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,          -- s_<ulid>
  title         TEXT NOT NULL,
  mode          TEXT NOT NULL,             -- agent|plan|ask
  created_at    INTEGER NOT NULL,
  status        TEXT NOT NULL,             -- running|done|paused|error
  budget_usd    REAL,
  budget_tokens INTEGER
);

-- Every loop step (observe/think/act) — the replayable timeline
CREATE TABLE steps (
  id          TEXT PRIMARY KEY,            -- st_<ulid>
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  idx         INTEGER NOT NULL,            -- order within session
  phase       TEXT NOT NULL,              -- observe|think|act
  model       TEXT,                        -- which model ran this
  tool        TEXT,                        -- tool name if act
  input_json  TEXT,                        -- redacted
  output_json TEXT,                        -- redacted
  trust       TEXT NOT NULL DEFAULT 'trusted', -- trusted|quarantined
  snapshot    TEXT,                        -- git ref for file changes
  created_at  INTEGER NOT NULL
);

-- Cost accounting (powers the Governor + Cost Auditor skill)
CREATE TABLE cost_events (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  step_id     TEXT REFERENCES steps(id),
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  in_tokens   INTEGER NOT NULL,
  out_tokens  INTEGER NOT NULL,
  usd         REAL NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Skills registry (markdown body lives in files; metadata + versions here)
CREATE TABLE skills (
  id          TEXT NOT NULL,               -- skill slug
  version     INTEGER NOT NULL,
  path        TEXT NOT NULL,               -- skills/<id>/
  signed      INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL,               -- preloaded|learned
  why         TEXT,                         -- "why I learned this"
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (id, version)
);

-- Non-regression: frozen, verified-good action sequences
CREATE TABLE frozen_baselines (
  id          TEXT PRIMARY KEY,            -- fb_<ulid>
  skill_id    TEXT NOT NULL,
  skill_ver   INTEGER NOT NULL,
  steps_json  TEXT NOT NULL,               -- immutable action sequence
  verifier    TEXT NOT NULL,               -- how success was checked
  frozen_at   INTEGER NOT NULL
);

-- Regression suite cases (re-run after any skill update)
CREATE TABLE regression_cases (
  id          TEXT PRIMARY KEY,
  skill_id    TEXT NOT NULL,
  baseline_id TEXT NOT NULL REFERENCES frozen_baselines(id),
  input_json  TEXT NOT NULL,
  expected    TEXT NOT NULL,               -- expected verifiable outcome
  last_status TEXT,                         -- pass|fail
  last_run_at INTEGER
);

-- Tamper-evident audit log (hash-chained; redacted)
CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  session_id  TEXT,
  event       TEXT NOT NULL,               -- action|approval|deny|failover|rollback...
  detail_json TEXT NOT NULL,               -- secrets redacted
  prev_hash   TEXT,                         -- hash chain
  hash        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Provider health cache (powers failover UI)
CREATE TABLE provider_health (
  provider    TEXT PRIMARY KEY,
  status      TEXT NOT NULL,               -- healthy|degraded|down|no_key
  latency_ms  INTEGER,
  checked_at  INTEGER NOT NULL
);

-- Approval rules ("always for this skill")
CREATE TABLE approval_rules (
  id          TEXT PRIMARY KEY,
  scope       TEXT NOT NULL,               -- skill id or "global"
  tool        TEXT NOT NULL,
  decision    TEXT NOT NULL,               -- allow|deny
  created_at  INTEGER NOT NULL
);
```

## 4. Provider manifest schema (providers/*.json)
```json
{
  "id": "groq",
  "label": "Groq",
  "base_url": "https://api.openai.com/v1",   // OpenAI-compatible endpoint
  "auth": { "type": "bearer", "keychain_key": "sentinel.groq" },
  "models": [
    { "id": "llama-3.3-70b", "role": "smart", "ctx": 128000,
      "price": { "in_per_mtok": 0.59, "out_per_mtok": 0.79 } }
  ],
  "structured_output": "native",     // native | grammar | tooluse
  "tool_call_format": "openai",
  "supports_streaming": true
}
```
> Adding a new provider = drop a JSON file. **No code change, no release** → kills the "an update broke my provider" complaint.

## 5. Skill file format (skills/<id>/SKILL.md)
```markdown
---
id: daily-brief
version: 2
source: preloaded
tools: [web_fetch, write_file]
verifier: "file daily-brief-<date>.md exists and non-empty"
signed: true
---
# Daily Brief
1. Fetch configured sources (egress allow-listed).
2. Summarize top items with the cheap model.
3. Write to memory/operational/<date>.md and present.
```

## 6. Audit-log redaction & hashing
- Before write: run redaction filter (strip anything matching keychain values / `sk-…` / bearer patterns).
- `hash = sha256(prev_hash + detail_json + created_at)` → tamper-evident chain; `sentinel verify-log` recomputes.
