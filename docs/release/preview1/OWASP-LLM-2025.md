# OWASP Top 10 for LLM Applications (2025) — XR Preview 1 pass

Plan section 6. Each row states the control that exists, the evidence that it works, and what it
does **not** cover. "Verified" means a test or a run produced the result; nothing here is asserted
from a docstring.

| # | Class | Control in XR | Evidence | Status |
|---|---|---|---|---|
| **LLM01** | Prompt injection | Every tool result is scanned and framed as untrusted data (`src/security/tool-output.ts` → `src/core/agent.ts`), research content goes through the same framer (`src/research/content-guard.ts`), and untrusted content never bypasses the approval plane | `test/security/tool-output-framing.test.ts` (7 tests: delimiter, provenance, zero-width/bidi smuggling, flagged-but-delivered); **new** `test/security/llm01-injection-e2e.test.ts` (4 tests) drives the whole loop: a poisoned file → the model obeys → requests `shell` → **denied at the approval gate**; with approval granted a **second independent gate** (isolation) still refuses to execute. Transcript shows `untrusted content flagged … instruction_override`. `test/context` 316 pass | **Verified** |
| **LLM02** | Sensitive information disclosure | Secret broker resolves keys; ambient env ignored by default; redaction in status/log paths; audit records carry no plaintext keys | T08: ambient keys are ignored unless opted in — verified both ways with `xr doctor`; `KNOWN_LIMITATIONS` row 30 documents it; BYOK smoke runs with no key on disk; exact-string scan of the tree and git history for the owner's live token and Groq key → **0 hits** | **Verified** (see gap note 1) |
| **LLM03** | Supply chain | Lockfiles, dependency audit, pinned GitHub Actions, plugin/MCP install trust | Earlier JS audits and tests passed, but recursive OSV found RUSTSEC-2026-0459 in the bundled desktop SQLite dependency; Supply Chain run 42897512989 failed. Candidate 0.39.1 passes local OSV but native CI and the Supply Chain gate remain pending. See T11.b and the readiness report. | **IN PROGRESS — CI pending** |
| **LLM04** | Data and model poisoning | Untrusted content is marked when it enters memory/context and must not silently become an instruction (`src/context/poison.ts`, `scanUntrusted`) | `test/context` 316 pass, including the poison-detection path; the framing tests pin the marker | **Verified** (heuristic, not a proof — see gap note 2) |
| **LLM05** | Improper output handling | D1 (the `new Function()` workflow-condition executor) removed and tested; tool arguments are schema-checked (`shell` requires a non-empty `cmd`); desktop renders markdown/HTML under CSP with no inline script or inline style | T01 (D1); `test/security` 381 pass; desktop build + `desktop:sink-lint`; dashboard DOM/CSP hash pin normalizes only generated identity fields | **Verified** |
| **LLM06** | Excessive agency | Deny-by-default policy, approval plane, sandbox tiers, D5 fail-closed on Windows/macOS | Windows runner: `shell / arbitrary code` → **`BLOCKED (fail-closed)`** with real remediation (run 42707408342); unattended approval denies with exit code 4 on Linux and Windows; `test/trust` 159 pass | **Verified** |
| **LLM07** | System prompt leakage | No secrets in prompts; keys resolve through the broker at request time, not from the prompt | Secret-scan result above; broker path traced in T08 | **Verified** (low priority, as the plan says) |
| **LLM08** | Vector and embedding weaknesses | If embeddings are used, retrieval is workspace-scoped | `test/context` 316 pass (retrieval, quarantine, ACL paths) | **Verified for the paths exercised**; no cross-workspace retrieval test was added this week — see gap note 3 |
| **LLM09** | Misinformation | Research output carries sources and surfaces failures instead of swallowing them; content guard frames fetched pages | `test/research` 66 pass, including `security.test.ts`; the research screen's own tests are in the desktop suite | **Verified** |
| **LLM10** | Unbounded consumption | Budget governor with atomic admission, per-step estimate before the call, retry/fallback settlement, step ceilings and timeouts | `test/cost.test.ts` 6, **new** `test/cost-adversarial.test.ts` 5 (retry storm exhausts the cap; failed attempts are charged, not free — **mutation-proven**), `test/phase2` 56, `test/phase6` 89 | **Verified** |
| — | Daemon / desktop extras | Loopback bind + bearer token; Tauri IPC least privilege pinned against `generate_handler!`; CSP with no `unsafe-inline`; updater signature check; deep-link validation | `test/api/chat-stream.test.ts` (token not embedded in HTML), `test/desktop/ipc-acl.test.ts` pins, CI Accessibility + API contract jobs green on 3ce03afe | **Verified** |

## Gap notes (stated, not hidden)

1. **LLM02** — the guarantee is "the controls tested did not expose the test keys". There is no test that scans a
   full audit export or a crash report for key-shaped strings end to end; the check performed was a
   repository/history scan plus the broker tests. A transcript-level scanner is worth adding after
   Preview.
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
