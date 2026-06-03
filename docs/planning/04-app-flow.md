# 04 — App Flow
### SENTINEL · v1.0 · 2026-06-03

Flows shown as step lists + ASCII flow diagrams. These define the runtime behavior the implementation must satisfy.

---

## 1. Onboarding flow
```
start
 └─ detect environment (Ollama? existing config?)
     ├─ choose power source: Local / Cloud / Both
     │    ├─ Local  → pick Ollama model → test grammar tool-call → ✓
     │    └─ Cloud  → paste key → store in keychain → health check → ✓
     ├─ set spend ceiling (default $0.25; local=$0)
     ├─ set default mode (Agent/Plan/Ask)
     ├─ write config v_current (schema-validated)
     └─ done → ready prompt
```

## 2. The core Agent Loop (Observe → Think → Act) with all guards
```
receive task (trusted input)
 └─ COST GOVERNOR: assign budget; start meter
 └─ POLICY: load mode tool-allowlist (Ask=read-only, etc.)
 └─ loop:
     1. OBSERVE  gather context (memory retrieve, workspace, prior steps)
     2. COST     est next step; if spent+est > ceiling → PAUSE→ask user
     3. ROUTE    pick model (cheap vs smart) for this step
     4. THINK    RELIABILITY HARNESS:
                   • build prompt + tool schemas
                   • if local → attach GBNF grammar
                   • call model → get tool call(s)
                   • validation sandwich: grammar→Zod→semantic
                   • malformed? auto-repair → re-ask once → else fail-safe
     5. UNTRUSTED? if a step must read untrusted data:
                   → route to QUARANTINED LLM (no tools) → typed result only
     6. POLICY   check capability/taint on tool + args
     7. ACT      if risky (write/delete/shell/send) → APPROVAL GATE
                   • show diff/summary + cost + sandbox/egress status
                   • approve / review / edit / deny  (default-deny on timeout)
                 execute in TOOL RUNTIME (sandbox; egress allow-list)
     8. RECORD   append to audit log (redacted) + cost_events; git-snapshot file changes
     9. COMPRESS if step % N == 0 → summarize context
    10. STOP?    completion criteria met? OR no-progress detected? → end : repeat
 └─ deliver result + cost summary
 └─ SELF-IMPROVE? (see flow 5)
```

## 3. Provider failover flow
```
need model call
 └─ pick primary provider (per Router)
     ├─ healthy? → call
     │    ├─ success → return
     │    └─ error/timeout/quota → mark unhealthy
     │         └─ failover to next configured provider (same role)
     │              ├─ success → return + notify "switched to <provider>"
     │              └─ none left → PAUSE → ask user (add key / use local / stop)
```

## 4. Approval gate flow
```
risky action requested
 └─ classify (write/delete/shell/send/keys/financial)
 └─ already "always-approved" for this skill? → execute
 └─ else show prompt (diff + reason + cost + sandbox/egress)
     ├─ approve once → execute
     ├─ always (this skill) → store rule → execute
     ├─ edit → modify → re-prompt
     ├─ deny → log + return DENIED to loop
     └─ timeout → DENY (fail closed)
```

## 5. Non-regressive self-improvement flow
```
task finished successfully
 └─ does this task have an objective verifier? (test/diff/exit/explicit approve)
     ├─ no  → do NOT auto-learn (offer manual save only)
     └─ yes → verifier passed?
          ├─ no  → discard candidate
          └─ yes → propose freeze (show user: skill, steps, why)
               └─ user freezes →
                    • store immutable frozen baseline (new skill version)
                    • add this case to the regression suite
               └─ later, any skill update →
                    • run backward-transfer regression suite
                    • any past frozen win regresses? → AUTO-ROLLBACK + log why
```

## 6. Update flow (self-healing)
```
sentinel update
 └─ download new version → install to ./versions/<v_new>
 └─ run self-test: boot + canned task + injection smoke
     ├─ pass → atomically switch symlink to v_new → done
     └─ fail → keep current → report failure → suggest `sentinel rollback`
```

## 7. Config-load flow (never crashes)
```
boot
 └─ read config → validate (Zod, with version)
     ├─ valid & current → use
     ├─ valid & older   → run ordered migrations → save → use
     └─ invalid → print exact bad field + suggested fix
                  → load last-known-good snapshot → continue (never crash)
```

## 8. Injection-test flow
```
sentinel test --attacks
 └─ load attack corpus (AgentDojo-style: instruction override, indirect inject,
    tool-hijack, exfil, ASCII-smuggle…)
 └─ run each against agent in dry-run sandbox
 └─ report blocked/total + per-attack detail + write report file
```
