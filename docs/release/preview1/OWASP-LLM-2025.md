# OWASP Top 10 for LLM Applications (2025) — XR Preview 1 pass

Plan section 6. Each row states the control that exists, the evidence that it works, and what it
does **not** cover. "Verified" means a test or a run produced the result; nothing here is asserted
from a docstring.

| # | Class | Control in XR | Evidence | Status |
|---|---|---|---|---|
| **LLM01** | Prompt injection | Tool output is scanned and framed as untrusted; policy, approval and isolation independently govern dangerous actions | `llm01-injection-e2e.test.ts`: payload-dependent scripted provider, poisoned file, shell approval denied and independent isolation refusal; benign control. `llm01-web-mcp-e2e.test.ts`: real loopback `fetch_url` and production MCP wrapper with fake client, poisoned and benign controls; poisoned shell requests denied. Security suite 386 pass. | **PARTIAL** — scripted provider and MCP client, not a live model or live external MCP server; no claim that every possible injection or tool call is blocked |
| **LLM02** | Sensitive information disclosure | Broker, disabled-by-default opt-in telemetry and bounded redaction | New synthetic tests exercise nested fields and credential-shaped event/project text in fresh audit rows, structured logs and the Markdown audit report; telemetry privacy tests cover the disabled default. Rust crash redaction has unit tests. | **PARTIAL** — heuristics are not complete; existing records/transcripts and all renderer paths have not been scanned end to end; optional telemetry exists |
| **LLM03** | Supply chain | Lockfiles, dependency audit, pinned GitHub Actions, plugin/MCP install trust | Supply Chain run 42912762788 passed on f8a0ce71 after the SQLite fix; final candidate/native packaging and broader install-trust checks still need evidence. | **IN PROGRESS** |
| **LLM04** | Data and model poisoning | Untrusted content is marked when it enters memory/context and must not silently become an instruction (`src/context/poison.ts`, `scanUntrusted`) | `test/context` 316 pass, including the poison-detection path; the framing tests pin the marker | **Verified** (heuristic, not a proof — see gap note 2) |
| **LLM05** | Improper output handling | D1 (the `new Function()` workflow-condition executor) removed and tested; tool arguments are schema-checked (`shell` requires a non-empty `cmd`); desktop renders markdown/HTML under CSP with no inline script or inline style | T01 (D1); `test/security` 382 pass; desktop build + `desktop:sink-lint`; dashboard DOM/CSP hash pin normalizes only generated identity fields | **Verified** |
| **LLM06** | Excessive agency | Approval plane and Trust sandbox; direct Windows/macOS host-control paths now refuse | Windows Preview run 42911178973 native refusal tests passed; platform-specific and desktop-native reruns still pending. | **PARTIAL** — no universal isolation claim or verified Windows AppContainer |
| **LLM07** | System prompt leakage | Broker-based credentials and selective redaction | Broker and secret-pattern tests exist, but they do not prove every prompt and transcript excludes secrets. | **PARTIAL** — no full end-to-end prompt/transcript scan |
| **LLM08** | Vector and embedding weaknesses | If embeddings are used, retrieval is workspace-scoped | `test/context` 316 pass (retrieval, quarantine, ACL paths) | **Verified for the paths exercised**; no cross-workspace retrieval test was added this week — see gap note 3 |
| **LLM09** | Misinformation | Research output carries sources and surfaces failures instead of swallowing them; content guard frames fetched pages | `test/research` 66 pass, including `security.test.ts`; the research screen's own tests are in the desktop suite | **Verified** |
| **LLM10** | Unbounded consumption | Budget governor with atomic admission, per-step estimate before the call, retry/fallback settlement, step ceilings and timeouts | `test/cost.test.ts` 6, **new** `test/cost-adversarial.test.ts` 5 (retry storm exhausts the cap; failed attempts are charged, not free — **mutation-proven**), `test/phase2` 56, `test/phase6` 89 | **Verified** |
| — | Daemon / desktop extras | Loopback bind, bearer token, IPC grants, CSP, updater signatures and deep links | Local compiled Linux sidecar rejects anonymous/invalid bearer and accepts valid bearer; IPC ACL tests passed. CSP disallows inline script but allows inline styles. | **PARTIAL** — current native installer, all IPC paths, update and deep-link evidence remain incomplete |

## Gap notes (stated, not hidden)

1. **LLM02** — the new tests cover synthetic values in selected new audit/log/report paths; redaction
   is heuristic, not a guarantee for arbitrary secret formats. Historical records are not rewritten,
   and there is no end-to-end transcript or full crash-report scan. Telemetry exists as an explicit
   opt-in and defaults to disabled; it is not accurate to say XR has no telemetry.
2. **LLM04** — poisoning detection is a signature heuristic with an audit trail, exactly as
   `tool-output.ts` says. It is defense-in-depth, not immunity, and it is labelled that way in the
   source and here.
3. **LLM08** — no new cross-workspace retrieval isolation test was written this week. The existing
   context/ACL suites pass; treating that as proof of isolation without a targeted test would be the
   same mistake this release keeps catching elsewhere.

## Scope note on OPSWAT

The brief mentions "OPSWAT". OPSWAT is a file-scanning vendor (MetaDefender), not an LLM
application standard, so it has no row in this table. If upload scanning of ingested files is
wanted, it is a separate optional feature with a vendor dependency, and it belongs after Preview 1.
