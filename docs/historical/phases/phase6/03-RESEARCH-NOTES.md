# Phase 6 — Step 3 Research Notes (principles adopted, with sources)

Adopted as *principles*; XR is its own runtime, so nothing was copied wholesale.

## R1 — Production agent-memory patterns (`rohitg00/agentmemory`, ~26k★)
Source: [github.com/rohitg00/agentmemory](https://github.com/rohitg00/agentmemory), [benchmark/COMPARISON.md](https://github.com/rohitg00/agentmemory/blob/main/benchmark/COMPARISON.md), [mdgrok mirror](https://mdgrok.com/repos/rohitg00/agentmemory).

- **Principle:** persistent-across-sessions; **memory-as-tools** (the agent queries memory, instead of memory being pasted); hook-integrated capture at lifecycle events; an inspectable viewer; **benchmark-first claims** (README leads with LongMemEval R@5 = 95.2% BM25+Vector hybrid vs 86.2% BM25-only — the hybrid lift is ~9 points, which is exactly what Phase 6 must replicate and *measure*, not assert).
- **Principle:** RRF fusion of BM25 + vector channels is the production default for hybrid memory; decay + consolidation tiers; supersession for contradiction handling.
- **Adoption:** XR already has consent + hooks at write time; Phase 6 adds navigable tools, RRF hybrid, consolidaton lifecycle, measured recall. The Claude-Code/MCP plugin *packaging* is explicitly not adopted (XR is its own runtime).

## R2 — Memory-as-tools beats single-shot RAG
Source: agentmemory design/measurements (above) + MemoryAgentBench protocol (below), which evaluates memory agents via **incremental multi-turn interaction** (“inject incrementally, query many times”) precisely because single-shot pasting fails at scale ([arXiv:2507.05257](https://arxiv.org/html/2507.05257v1)).

- **Principle:** navigate (retrieve → follow-up → follow links → resolve contradictions) instead of top-k-only injection; lower token cost; cross-document correctness improves because the agent can re-query with what it learned.
- **Adoption:** Phase 6 ships read-only `memory_search/get/navigate/conflicts` tools plus a regression test that *proves* the navigable path answers a cross-document question that single-shot top-k cannot.

## R3 — Benchmark competencies: MemoryAgentBench (ICLR 2026)
Source: [HUST-AI-HYZ/MemoryAgentBench](https://github.com/HUST-AI-HYZ/MemoryAgentBench), [arXiv:2507.05257](https://arxiv.org/html/2507.05257v1).

- **Four competencies:** Accurate Retrieval · Test-Time Learning · Long-Range (consistency) · **Conflict Resolution** (FactConsolidation: later facts must win over earlier ones).
- **Protocol:** inject-once, query-many-times; measure accuracy/recall@k per competency.
- **Adoption:** XR’s harness implements the same four competencies over 4 domains (code/research/personal/business) with deterministic assertions (substring/ID match — no LLM judge, so the numbers are reproducible on CI).

## R4 — Recall methodology: LongMemEval/LoCoMo
Sources: agentmemory benchmark table (R@5/R@10/NDCG/MRR on LongMemEval-S), [mdgrok mirror](https://mdgrok.com/repos/rohitg00/agentmemory).

- **Principle:** report Recall@k + MRR per query type; hybrid vs lexical ablation reveals the lift; keep a lexical-baseline row so motion is measurable.
- **Known gaps these benchmarks do NOT cover** (and XR must test itself): memory drift at scale, **memory poisoning**, and multi-tenant/scope isolation — XR covers poisoning via T3’s corpus and scope isolation via existing Phase-2 fences + tests.

## R5 — Lineage-first vs recall-first
Source: XR Constitution Art. VIII (+ §2.1 P5 “Evidence outranks confidence”).

- **Principle:** for a trust/audit-focused system, inspectability beats raw recall; every item carries scope/source/freshness/confidence/consent/reason — the recall explanation is a first-class output, and *every* Phase-6 feature must preserve it through fusion, reranking, lifecycle promotion, and compression.

## R6 — Anti-poisoning (MINJA / MemoryGraft class attacks)
Sources: [Promptfoo LM Security DB: Agent Persistent Memory Poisoning (MINJA)](https://www.promptfoo.dev/lm-security-db/vuln/agent-persistent-memory-poisoning-7e5fb607), [FutureAGI glossary: MINJA](https://futureagi.com/glossary/memory-injection-attack/), [Hannecke, “Agent Memory Poisoning — The Attack That Waits” (MemoryGraft)](https://medium.com/@michael.hannecke/agent-memory-poisoning-the-attack-that-waits-9400f806fbd7).

- **Threat model:** query-only memory poisoning (benign-looking queries induce storage of malicious “facts”; a later retrieval re-injects them as trusted context); socially-engineered sanitization bypass; semantic-imitation attacks (poisoned “successful experience”).
- **Principles:** retrieved content is never authority; **integrity validation at render time** (write-time scans are insufficient — policies and signatures evolve after storage); instruction/data separation in the message array; a maintained poisoning corpus as a regression gate (incl. “indication prompt” patterns: standing directives, consent forgery, source spoofing, exfil instructions, tool directives, fake system headers, unicode/template smuggling).

## R7 — Evidence-preserving compression
Source: XR Constitution Art. VIII.4; MemGPT/Letta archival-memory precedent (comparator table, R1).

- **Principle:** retain claim/source links, decisions, unresolved uncertainty, rejected alternatives; **fail closed** when invariants cannot be preserved (existing `compressItems` already does — Phase 6 wires it into a progressive lifecycle and *proves* fidelity end-to-end).

## R8 — Hybrid retrieval + reranking (measured)
Source: agentmemory RRF results (R1); deterministic reranker already in `src/context/embedding.ts`.

- **Principle:** lexical + semantic + **structured** channels fused (RRF, k=60); reranking reorders with an explainable score; precision/recall of the fused pipeline is *measured* against declared targets, with the lexical-only path as the mandatory offline baseline.
