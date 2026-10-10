#!/usr/bin/env bun
/**
 * XR Phase 2 · T7 — module size/complexity gate.
 *
 * Constitution Art. V.3: *"No module exceeds a defined size/complexity
 * threshold without an owned plan to split."*
 *
 * The gate is deliberately two-tier, because Art. V.3 permits an
 * over-threshold module **with an owned plan** — it does not demand that every
 * module be under the line today:
 *
 *   · Any module over THRESHOLD that is NOT in the waiver register  → FAIL
 *   · Any waived module that has GROWN since its waiver was recorded → FAIL
 *     (a waiver is permission to be big, never permission to get bigger)
 *   · A waiver with no owner, no reason, or no review date           → FAIL
 *   · A waiver for a file that is now under threshold                → FAIL
 *     (stale waivers must be removed, so the register stays truthful)
 *
 * That last rule matters: a register full of obsolete entries is exactly the
 * "green but not true" signal this project exists to eliminate.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SRC = join(ROOT, "src");
const REGISTER = join(ROOT, "docs/perf/SIZE-WAIVERS.json");

/** Lines of code per module. */
export const THRESHOLD = 800;

/**
 * ── Phase 5 · the TREE ceiling (ADR-0028) ───────────────────────────────────
 *
 * The per-module threshold above says nothing about total size: a repo can be
 * 500k LOC with every file under 800 and pass. Phase 5 removed 23,376 LOC of
 * userless surface from core, and the only thing that keeps that won is a
 * ceiling on the whole tree — otherwise the sprawl grows back one compliant
 * 799-line module at a time, which is exactly how it arrived.
 *
 * The number is MEASURED, not aspirational. The Phase 5 plan targeted
 * "≤ ~110,000 LOC", written against a 149,722-LOC tree four phases stale; the
 * tree was 154,426 when the phase began, and extracting everything the plan
 * listed would still have landed near 124k. Gating on 110k would have meant
 * either failing the build forever or deleting genuine runtime to satisfy an
 * estimate — so the gate holds the line actually achieved, and the roadmap
 * keeps 110k as a direction of travel (docs/historical/phase-5/loc-census.md).
 *
 * Raising this number is allowed — it just has to be a decision someone makes
 * on purpose, in a diff, with a reason. That is the whole mechanism.
 *
 * ── Phase 7 · 135,000 → 136,000 (memory policy layer, F-21) ────────────────
 * Phase 7 began at 134,258 LOC (742 of headroom) and adds ~1,200 LOC of new
 * policy surface that the plan requires in core: retrieval ACL (acl.ts),
 * mandatory provenance + contradiction ledger (provenance.ts), supersede-only
 * consolidation (consolidate.ts), irreversible forget + labelled export
 * (forget-export.ts), their CLI (cli-phase7.ts) and migration 9. None of it
 * is a satellite candidate — it gates what an agent may recall — and the
 * waived giants (store.ts, agent.ts, config.ts) were held at their recorded
 * sizes rather than grown. Measured after the phase: 135,4xx. The step is the
 * smallest round number that fits; 110k stays the direction of travel.
 *
 * ── Phase 8 · 136,000 → 137,000 (capability grants + ecosystem hardening) ──
 * Phase 8 adds first-class grant artifacts, secret-broker completion,
 * plugin signed-allowlist, MCP isolation grants (flag removal), and
 * headless typed-confirm — all required in core by the reconciliation
 * plan (XR801–XR806). Waived giants were not grown (agent.ts extracted
 * loop-grant.ts; config.ts extracted migrate-21.ts). Measured ~136.6k.
 * Smallest round number that fits; 110k stays the direction of travel.
 *
 * ── Phase 9 · 137,000 → 139,000 (channel & proactivity) ────────────────────
 * Phase 9 adds the governed trigger table, scheduler spine fire, Telegram
 * token-bucket + per-chat budgets, and flagged voice v2 helpers. Config and
 * schema growth was extracted (migrate-22.ts, migrate-11.ts) so waived giants
 * did not grow. Measured ~138.1k. Smallest round number that fits.
 *
 * ── Desktop Phase 2B · 139,000 → 139,500 (files.write + terminal.run) ──────
 * Phase 2B adds the two daemon routes the desktop rebuild plan deferred:
 * the approval-gated editor save (files.write, in files.routes.ts) and the
 * policy-checked, consent-gated, SSE-streamed command runner (terminal.run,
 * terminal.routes.ts — 194 lines). Both are consent-plane surfaces: they
 * compose the existing approval store, structured previews, guard policy and
 * audit chain, and cannot live in a satellite without splitting the security
 * boundary the routes exist to enforce. No waived giant grew (files.routes.ts
 * 215 → 285, both far under threshold). Measured 139,162. Smallest round
 * number that fits; 110k stays the direction of travel.
 *
 * ── Phase 4 · 139,500 → 140,000 (MCP pinning / SEC-01) ─────────────────────
 * Phase 4 adds the rug-pull defense the 2026 MCP supply-chain guidance
 * demands: src/mcp/pins.ts (pin store + pure gate), the drift re-approval
 * branch in the tool wrapper, four governed routes, and the skills-pin
 * surface (SEC-02). This is consent-plane code: it composes the existing
 * approval store and audit chain and cannot live in a satellite without
 * splitting the MCP authority boundary it extends. No waived giant grew
 * (mcp/client.ts +30, manager.ts +6). Measured 139,574. Smallest round
 * number that fits; 110k stays the direction of travel.
 *
 * ── Phase 4 · 140,000 → 140,500 (offline voice pipeline surface) ───────────
 * Phase 4 voice adds the daemon transport the injected pipeline was missing
 * (voice.routes.ts: session state machine, endpointing, SSE downlink,
 * approvals-in-voice) plus native.ts, the fail-closed loader for the optional
 * on-device sherpa-onnx STT/Piper TTS bindings, and the sherpa branches in
 * stt.ts/tts.ts. This is consent-plane transport: it composes the existing
 * pipeline, VAD and approval store and cannot live in a satellite without
 * splitting the audio authority boundary. No waived giant grew (stt.ts +24,
 * tts.ts +18). Measured below. Smallest round number that fits; 110k stays
 * the direction of travel.
 */
// Phase 24 (Telegram) · 156,000 → 157,500 (2026-10-10). Measured 156,777 on main +
// Phase 24. The Telegram runtime (pairing, lifecycle, approvals, attachments, voice,
// MarkdownV2 output), its daemon routes and its desktop dialogs add about 1,600 LOC of
// core. The fix that keeps the gate honest is a maintainer decision: either accept this
// reasoned raise, or move the Telegram runtime to a satellite in a follow-up. This PR
// asks for the decision. Headroom is intentionally small (about 700 LOC).
export const TREE_CEILING = 157_500; // Phase 22 (Integrations) · 154,000 → 156,000 (2026-10-09):
// the integrations engine: the CredentialVault wiring (integration table and
// keychain-held master key), connection store, GitHub OAuth (PKCE, state,
// refresh, revoke), API-key probes, the service, routes and contract. Tokens and
// keys are consent-plane data, so they stay in core beside the vault. Measured
// 154,925 at PR head. This is a maintainer decision: a second raise in two phases.
// Follow-up: move the provider strategies to a satellite. Phase 21 note follows.
// Phase 21 (Memory Explorer) · 153,000 → 154,000 (2026-10-09):
// the memory explorer adds the engine write routes (add, edit, export, import,
// graph, settings, consolidate, scan-sensitive), the sensitivity scanner, the
// heuristic graph and the desktop screen. These are consent-plane writes (they
// gate what is remembered), so they stay in core. Measured 153,657 at PR head.
// Phase 20 (Skills Store) · 152,500 → 153,000 (2026-10-09):
// the skills store is engine-backed: the install engine (quarantine policy,
// install jobs with SSE progress, promote, parked dangerous grants, settings
// validation, install-from-URL preview) lives in src/skills/quarantine.ts,
// src/skills/install-jobs.ts and the extended skill-service.ts / skills-api.ts,
// and it composes the existing SkillService, quarantine schema and approval
// store. It is consent-plane (quarantine and dangerous-grant enforcement),
// so it cannot move to a satellite. No waived giant grew. Net core change from
// this phase is about +1,180 LOC; measured 152,918. Smallest round number that
// fits; 110k stays the direction of travel. Needs maintainer sign-off.
// Phase 19 (Agents) · 149,000 → 152,500 (2026-10-08):
// the Agents screen is wired to the EXISTING multi-agent runtime and the
// EXISTING workflow DAG engine; the engine half is what the UI was missing:
// the daemon finally constructs the engine (workflow-runtime.ts: agent
// runner over the canonical AgentService with per-node tool scope and
// permissions enforced engine-side, core-tool executor behind durable
// approvals, human nodes as approval records, SSE replay), the canvas →
// canonical compiler + decompiler (canvas.ts), the definition linter
// (lint.ts), run events (events.ts), versioned custom-agent JSON documents
// with schema validation (agents/custom-store.ts), and the routes +
// contract/schemas (workflows.routes.ts, custom-agents.routes.ts,
// contract-agents.ts, schemas-agents.ts). Approvals, cost and audit sit
// with the store, so this is consent-plane transport and cannot move to a
// satellite. Waived giants that grew: engine.ts (1163 → 1378, register
// updated) and the generated client (979 → 1089, register updated).
// Measured 151,742. Smallest round number that fits with headroom for the
// recorder labels still to land; 110k stays the direction of travel.
//
// Phase 18 (Research) · 148,000 → 149,000 (2026-10-07):
// the desktop Research screen is wired to the EXISTING research engine
// (runResearch) rather than a second loop, so the engine half is thin:
// structured run events beside the say() lines (run-events.ts), an in-memory
// run registry with SSE replay + AbortSignal cancellation (run-registry.ts),
// the config-driven deps builder shared with the CLI (run-deps.ts), in-memory
// PDF text extraction (pdf-text.ts), research→memory bridge (remember.ts),
// and the routes + contract/schemas (research-run.routes.ts,
// contract-research.ts, schemas-research.ts). Cancel and budget live with the
// store + audit log, so this is consent-plane transport again and cannot move
// to a satellite. No waived giant grew except the generated client
// (940 → 979, register updated). Measured 148,688. Smallest round number
// that fits; 110k stays the direction of travel.
//
// Phase 17 (Builder) · 145,500 → 148,000 (2026-10-06):
// the Builder's engine half: registered project roots with the same
// insideRoot scope rule as the dashboard files (builder-projects.ts, incl.
// the recursive watcher + backup naming), a pure content-matching unified
// diff applier (builder-patch.ts — the human reviews hunks, the engine lands
// them or refuses with a conflict report), engine-owned dev servers with
// honest readiness (dev-servers.ts), and the approval-gated SSE mutation
// routes (builder.routes.ts / builder-dev.routes.ts / builder-shared.ts,
// every write through the durable approval store + audit log) with their
// contract entries (contract-builder.ts) and schemas. Consent plane again:
// it composes the approval store, policy gate and audit log and cannot move
// to a satellite without splitting them. proc-tree.ts (process-tree kill)
// exists because `npm run dev` is a wrapper: stopping only the top pid
// orphaned the real listener. No waived giant grew except the generated
// client (854 → 940, register updated). Measured 147,564. Smallest round
// number that fits; 110k stays the direction of travel.
// Phase 15 (voice) · 144,500 → 145,500 (2026-10-06):
// the voice loop becomes real for a first-run user: a measured model
// catalogue + resumable downloader (models.ts, 354 — the only place that
// knows byte sizes, so the download card can never lie), catalogue-driven
// native binding with per-voice Piper loading (native.ts), transcript shaping
// + cloud price table (transcript.ts, 64), settings sanitiser, and the
// Phase 15 routes (models/voices/settings/download/test-tts/transcribe) with
// durable approvals and cost events in voice.routes.ts (788, under 800).
// Audio authority + consent plane again: it composes the approval store,
// the config service and the native loader and cannot move to a satellite
// without splitting them. No waived giant grew (config.ts enum edits were
// in-line). Measured 145,092. Smallest round number that fits; 110k stays
// the direction of travel.
// Phase 14 (real LLM wire) · 144,000 → 144,500 (2026-10-06):
// the default run path streams for real: `chatStream()` on ResilientProvider
// (degradation.ts +170) and the legacy FallbackProvider (routing-service.ts
// +56) with the same fail-over rule as `chat()`; ConfigService.reload() per
// run; config-named local models in the catalog (+58); SSE keepalive in
// chat.routes.ts; bounded replayed history (agent-history.ts); empty-turn
// retry without tools in ask/plan. All of it is the provider/consent path
// every surface shares and cannot live in a satellite without splitting the
// run authority. No waived giant grew (agent.ts 1215 → 1203 after the split).
// Measured 144,055. Smallest round number that fits; 110k stays the direction
// of travel.
// Phase 2 (core workspace) · 142,500 → 144,000 (2026-09-20):
// engine-owned PTY sessions (pty-sessions.ts + terminal.routes.ts: a real
// terminal, consent per session), hunk-level review (hunks.ts +
// files.routes.ts + a patch-shaped approval preview), desktop UI state
// (migration 12 + ui-state.ts + routes), router `pattern`, generated-client
// growth. All of it composes the approval store and the write gate — the
// consent plane — and cannot live in a satellite without splitting that
// boundary. Measured 143,430 (+1,365 net over Phase 1's 169f496). Smallest
// round number that fits; 110k stays the direction of travel.
// Phase 4 · 141,000 → 142,500 (2026-09-18): BLUEPRINT-STATUS backlog batch:
// steer/review routes + reviewTask, trust-mode module + policy-gate wiring,
// control-cockpit route, agents/templates gallery route, voice semantic
// endpointing (endpointing.ts + session/v2 integration), generated-client
// growth. Measured 140,980.

interface Waiver {
  readonly path: string;
  readonly lines: number;
  readonly owner: string;
  readonly reason: string;
  readonly plan: string;
  readonly review: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * Lines of code, using `wc -l` semantics (count newline terminators) so the
 * number in the waiver register matches what a developer sees from the shell.
 * A trailing newline on the final line is not counted as an extra line.
 */
function countLines(file: string): number {
  const text = readFileSync(file, "utf8");
  if (text.length === 0) return 0;
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

export interface SizeReport {
  ok: boolean;
  threshold: number;
  /** Total LOC across src/ — the anti-regrowth ceiling (Phase 5). */
  treeLines: number;
  treeCeiling: number;
  treeOver: boolean;
  overThreshold: Array<{ path: string; lines: number }>;
  unwaived: Array<{ path: string; lines: number }>;
  grown: Array<{ path: string; lines: number; waivedAt: number }>;
  staleWaivers: string[];
  malformedWaivers: string[];
}

export function checkSizes(): SizeReport {
  const waivers: Waiver[] = JSON.parse(readFileSync(REGISTER, "utf8")).waivers;
  const byPath = new Map(waivers.map((w) => [w.path, w]));

  const sizes = walk(SRC)
    .map((f) => ({ path: relative(ROOT, f).replace(/\\/g, "/"), lines: countLines(f) }))
    .sort((a, b) => b.lines - a.lines);

  const overThreshold = sizes.filter((s) => s.lines > THRESHOLD);
  const unwaived = overThreshold.filter((s) => !byPath.has(s.path));
  const grown = overThreshold
    .filter((s) => byPath.has(s.path) && s.lines > byPath.get(s.path)!.lines)
    .map((s) => ({ ...s, waivedAt: byPath.get(s.path)!.lines }));

  const overPaths = new Set(overThreshold.map((s) => s.path));
  const staleWaivers = waivers.map((w) => w.path).filter((p) => !overPaths.has(p));

  const malformedWaivers = waivers
    .filter((w) => !w.owner?.trim() || !w.reason?.trim() || !w.plan?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(w.review ?? ""))
    .map((w) => w.path);

  const treeLines = sizes.reduce((n, m) => n + m.lines, 0);
  const treeOver = treeLines > TREE_CEILING;

  return {
    ok:
      unwaived.length === 0 &&
      grown.length === 0 &&
      staleWaivers.length === 0 &&
      malformedWaivers.length === 0 &&
      !treeOver,
    threshold: THRESHOLD,
    treeLines,
    treeCeiling: TREE_CEILING,
    treeOver,
    overThreshold,
    unwaived,
    grown,
    staleWaivers,
    malformedWaivers,
  };
}

if (import.meta.main) {
  const r = checkSizes();
  console.log(`[size-gate] threshold ${r.threshold} LOC · ${r.overThreshold.length} module(s) over, all waived unless listed below`);

  for (const m of r.unwaived) {
    console.error(`  FAIL over threshold with no owned plan: ${m.path} (${m.lines} lines)`);
  }
  for (const m of r.grown) {
    console.error(`  FAIL waived module grew: ${m.path} ${m.waivedAt} -> ${m.lines} lines`);
  }
  for (const p of r.staleWaivers) {
    console.error(`  FAIL stale waiver (module is now under threshold): ${p}`);
  }
  for (const p of r.malformedWaivers) {
    console.error(`  FAIL waiver needs owner, reason, plan and an ISO review date: ${p}`);
  }

  const pct = ((r.treeLines / r.treeCeiling) * 100).toFixed(1);
  console.log(`[size-gate] tree ${r.treeLines.toLocaleString()} LOC of ${r.treeCeiling.toLocaleString()} ceiling (${pct}%)`);
  if (r.treeOver) {
    console.error(
      `  FAIL core grew past the Phase 5 ceiling: ${r.treeLines.toLocaleString()} > ${r.treeCeiling.toLocaleString()} LOC.\n` +
      `       Phase 5 extracted 23,376 LOC to satellite packages so a one-person team could own core.\n` +
      `       Either move the new surface to a satellite, or raise TREE_CEILING in scripts/size-gate.ts\n` +
      `       deliberately, in a diff, with a reason (ADR-0028).`,
    );
  }

  if (r.ok) {
    console.log(`[size-gate] ✓ every module is under ${r.threshold} LOC or has an owned, dated split plan`);
    process.exit(0);
  }
  process.exit(1);
}

/* ── elite-workstation Phase 5 · desktop bundle caps (additive) ─────────────
   Interactive-shell startup budget: entry ≤ 350 kB, lazy chunks ≤ 750 kB.
   Skips when desktop/dist is absent (CI's architecture job doesn't build the
   desktop; desktop-app.yml does for real). */
export const BUNDLE_CAPS = { entryKb: 350, lazyKb: 750 };

export function checkBundles(): { ok: boolean; lines: string[] } {
  const dir = join(ROOT, "desktop/dist/assets");
  const lines: string[] = [];
  let ok = true;
  if (!existsSync(dir)) return { ok: true, lines: ["desktop/dist absent — bundle caps skipped here; enforced where the desktop builds"] };
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const kb = Math.round(statSync(join(dir, f)).size / 1024);
    const isEntry = f.startsWith("index");
    const cap = isEntry ? BUNDLE_CAPS.entryKb : BUNDLE_CAPS.lazyKb;
    if (kb > cap) ok = false;
    lines.push(`${kb > cap ? "✗" : "✓"} ${f} ${kb} kB (cap ${cap} kB, ${isEntry ? "entry" : "lazy"})`);
  }
  return { ok, lines };
}
