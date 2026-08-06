# ADR-0025 — Gated Remote Execution Behind the Phase-2 Envelope

- **Status:** Accepted — *design ratified; build gated* (Phase 10 · T6 design)
- **Owner:** Runtime Lead (interim: @ahmadrrrtx)
- **Date:** 2026-08-06
- **Constitution:** Art. VI.3 (one execution envelope, one placement
  authority), Art. IX (isolation follows risk; every action attributable and
  auditable), Art. XXI (locality is an invariant), Commandment 4 (every
  consequential action passes through one envelope), ADR-2 (single-authority
  test).

## Context

`src/enterprise/deployment/` contains a placement engine (real, explainable
scoring), a worker registry, a control-plane service, and a sync engine — all
**in-memory with injected transports** (`fetchRemote` is a dependency, never
implemented). There is no real remote backend adapter, no transport, and no
second execution path today. The Phase 10 contract (T6) requires that remote
execution, when it ships, **reuses the Phase-2 execution envelope** and can
**never bypass local policy, approval, or audit**.

## Decision

1. **Remote execution is a placement target, not a new execution path.** A
   task capsule (`TaskCapsule`, which already carries authority, approvalRef,
   provenance, and executionId) is the unit of movement. The capsule is
   validated and signed by the local envelope before any remote placement is
   attempted; the remote backend executes the capsule under the same policy
   decision that the local envelope recorded.
2. **Placement policies are part of the enterprise policy engine** (most-
   restrictive-wins across layers), so an org layer can constrain remote
   placement but can never enable it for work the user policy denies.
   `allowRemotePlacement` defaults to false.
3. **No control plane is mandatory.** The in-memory control-plane service is
   a local coordinator only; a remote backend adapter (the one thing that
   would make "control plane" a real network concept) ships behind the gate
   and is opt-in per deployment.
4. **Offline + eventual sync** reuse the existing `SyncEngine` contract
   (injected transport) — again gated, never a mandatory dependency.
5. **Evidence of "remote respects local policy"** is a first-class test
   requirement (Part 10 of the contract): a task moved between placements
   must carry the same authority, approval, provenance, and audit records.

## Why gated

Remote execution has no measured user (ADR-6), is high complexity (ADR-7),
and — done speculatively — would risk a second execution path (ADR-2) or a
mandatory cloud control plane (ADR-5). The design is ratified so that when
the gate reopens, the build starts from a constitutional design instead of
from scratch.

## Local-first preservation test (design-level)

A `personal_local` deployment compiles zero remote-execution code: placement
resolves to `local`, the capsule never leaves the process, and no transport
dependency exists. This must be asserted by a test at build time.

## Review

Re-evaluate with ADR-0024.
