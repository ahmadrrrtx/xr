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

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
// Phase 24 (Telegram) · 158,000 → 160,000 (2026-10-10). Measured 159,610 on main +
// Phase 24 (main alone is 157,848, so this phase adds about 1,760 LOC). The Telegram
// runtime is the bot itself (pairing, lifecycle, approvals, attachments, voice,
// MarkdownV2 output). The daemon routes and the desktop dialogs are included too.
// The approval and secret paths are consent-plane, so they stay in core beside the
// approval store and SecretBroker. The fix that returns core to the ceiling is a
// maintainer decision: accept this reasoned raise, or move the Telegram runtime to a
// satellite package in a follow-up. Headroom is intentionally small (about 390 LOC).
// Phase 26 · PR 2 (Discord) · 160,000 → 164,000 (2026-10-12). Measured 163,781 on
// this branch against 159,870 on main — main had 130 LOC of headroom, so the ceiling
// had to move or the surface could not land. What is here: the Discord adapter
// (REST + gateway client, product rules, commands, rendering, pairing book, state,
// Ed25519 webhook verification, lifecycle manager, daemon routes + contract), plus the
// PR-1 shared extraction the phase required (chunk/media/voice-note/parse moved into
// src/bots so all three surfaces share one policy). Discord is a consent-plane surface:
// its approvals resolve through the approval store and its token lives in the
// SecretBroker, so the runtime stays in core beside them — the same call Phase 24 made
// for Telegram. WhatsApp (PR 3) will measure its own delta and, if it needs room, this
// number gets raised again deliberately rather than folded in as an estimate. The
// alternative that returns core to the ceiling is moving the chat surfaces to a
// satellite package; that stays the recorded follow-up.
// Phase 30 (Business tier) · 169,000 → 172,000 (2026-10-14):
// the daemon-side half of the paid tier, which is deliberately thin because the
// point of Phase 30 is that the LOCAL product is unchanged. What lands in core is
// src/cloud/{license,client}.ts and src/daemon/routes/cloud.routes.ts: offline
// licence verification (node:crypto Ed25519 — no new dependency, because the file
// that decides what a customer is entitled to should be readable in one sitting),
// the typed cloud client that routes every request through the existing egress
// proxy, and the routes themselves, whose entire contract is that they answer
// usefully with no network at all. Consent plane again: licence state and session
// state sit beside the SecretBroker and the approval store and cannot move to a
// satellite without splitting them. The cloud SERVICE is a new top-level
// `cloud/` package and is not counted here (walk() reads src/ only); neither is
// the website. Phase 30 also does not grow any waived giant. Measured 169,373 at
// the first green build against 168,611 on main, so ~760 net for the daemon half
// plus room for the team-memory bridge (src/context/memory/team.ts) still to
// land. Headroom is deliberate and small (~2,600). Returns core toward the
// ceiling by moving the chat surfaces to a satellite; that stays the recorded
// follow-up and 110k stays the direction of travel. Needs maintainer sign-off.
// Launch audit Phase 2A · 172,000 → 172,500 (2026-10-22): lifecycle truthfulness
// fixes that cannot live in a satellite because they ARE the install surface:
// src/update/npm-channel.ts + src/update/check.ts (`xr update` on npm/bun global
// installs and `xr update --check`, XR-LAUNCH-007) and the marker-block rc
// strip in src/install/uninstall.ts (XR-LAUNCH-006). Measured 172,318 against
// ~171,964 at the Phase 1 commit (80007d7f): +354 net, of which 46 lines left
// atomic-updater.ts with the broken npm plan. Headroom ~180. Needs maintainer
// sign-off like every ceiling move.
// Launch audit Phase 2B · 172,500 → 173,500 (2026-10-22): the shell/file
// boundary, which is core trust surface and cannot move to a satellite:
// the unshare fallback now pivot_roots into a minimal root with every mount
// step checked and a detect-time self-check (XR-LAUNCH-004), the experimental
// opt-in macOS Seatbelt and Windows AppContainer mechanisms
// (src/runtime/trust/environment/{seatbelt,appcontainer}.ts, XR-LAUNCH-003)
// and the Windows ARM64 FFI self-test in fs-native.ts (XR-LAUNCH-005).
// Measured 173,010 (+692 over 2A). Headroom ~490. Needs maintainer sign-off
// and the security review that 2B requires anyway.
export const TREE_CEILING = 173_500; // Phase 28 · mobile companion · 168,000 → 169,000 (2026-10-13):
// the mobile companion's LAN half: the opt-in `--lan` transport (self-signed
// P-256 certificate generation, SANs, SHA-256 fingerprint, PEM under ~/.xr/certs),
// the device registry (hashed session tokens, revocation, mobile-kind tag),
// on-demand 6-digit pairing (10-minute TTL, single-use, per-source rate limit,
// HttpOnly cookie sessions, and the gate that answers 403 for mobile sessions on
// /files, /terminal, /git and /mcp), and browser-native Web Push (VAPID +
// RFC 8291/8188 outer layer + a device-key AES-GCM inner layer, so the push
// service relays ciphertext). Net src growth is +1,470 LOC (measured 168,611 at
// PR head against 167,141 on main — main had 859 LOC of headroom, so the ceiling
// had to move or the surface could not land). Pairing codes, device credentials
// and push keys are consent-plane data held by the daemon beside the existing
// approval store, so the runtime stays in core — the same call Phases 24 and 26
// made for the chat surfaces. The PWA itself is a separate npm project under
// mobile/ and is not counted here. The alternative that returns core to the
// ceiling is moving the mobile surfaces to a satellite package; that stays the
// recorded follow-up. Waived giants did not grow. Needs maintainer sign-off.
// Phase 26 · PR 3 (WhatsApp) · 164,000 → 168,000 (2026-10-12):
// the WhatsApp surface — the linked-device client (Baileys, imported lazily so
// a user who never links it never loads it), the sealed credential store, the
// 1:1 gate and outbox whitelist, the numbered-approval vocabulary, the task turn,
// the manager, and the daemon routes/contract/schemas incl. the QR stream. Net src
// growth is +3,112 LOC (measured 166,968 at PR head against the 163,856 Discord base
// of PR 2). Linking a device and holding its credentials is consent-plane work: it
// resolves through the same approval store and the same vault key, so it stays in
// core beside them — the same call Phase 24 (Telegram) and PR 2 (Discord) made, and
// the number PR 2's note said PR 3 would measure rather than estimate. The
// alternative that returns core to the ceiling is moving the chat surfaces to a
// satellite package; that stays the recorded follow-up. Waived giants did not grow.
// Needs maintainer sign-off.
// Phase 23 (xr coding agent CLI) · 156,000 → 158,000 (2026-10-10):
// the coding CLI (`xr`, `xr "task"`, `xr -p`, the REPL): session and approval
// engine, print/JSON/diff modes, mention and repo-map context, the first-run
// wizard, and the durable-store consent wrapper (cli/coder/consent.ts). The
// approval path is consent-plane: it resolves through the approval store and
// must stay in core beside the engine it calls. Net src growth from this phase
// is +2,653 LOC (measured 157,848 at PR head against the 155,195 base). Moving
// the coder to a satellite is the follow-up that would return core to the
// ceiling. Waived giants did not grow. Needs maintainer sign-off.
// Phase 22 (Integrations) · 154,000 → 156,000 (2026-10-09):
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

/* ── fix-program Phase 1.3 · --stamp-docs ─────────────────────────────────
 * TREE_CEILING above is the single source for the tree-size number. The two
 * published locations that quote it (README gates table + canonical register
 * row) and the frozen 1.1.0 excerpt carry it inside XR:TREE-CEILING markers,
 * exactly like the README's release-identity block. `--stamp-docs` rewrites
 * every marked value from this constant; `claim-lint` fails when any marked
 * or prose ceiling claim drifts. The stamp touches marker contents only —
 * never this file, never any other number. */
export const DOCS_STAMP_TARGETS = [
  "README.md",
  "docs/security/KNOWN_LIMITATIONS.md",
  "docs/release/1.1.0/known-limitations.md",
] as const;

export function stampDocs(root: string = ROOT): { changed: string[]; lines: string[] } {
  const value = TREE_CEILING.toLocaleString("en-US");
  const begin = "<!-- XR:TREE-CEILING -->";
  const end = "<!-- /XR:TREE-CEILING -->";
  const re = new RegExp(
    begin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^<]*" + end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "g",
  );
  const changed: string[] = [];
  const lines: string[] = [];
  for (const rel of DOCS_STAMP_TARGETS) {
    const abs = join(root, rel);
    if (!existsSync(abs)) throw new Error(`stamp target missing: ${rel}`);
    const before = readFileSync(abs, "utf8");
    const markerCount = (before.match(new RegExp(begin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
    if (markerCount === 0) throw new Error(`${rel}: no XR:TREE-CEILING marker — restore the published ceiling marker before stamping`);
    const after = before.replace(re, begin + value + end);
    if (after !== before) {
      writeFileSync(abs, after);
      changed.push(rel);
      lines.push(`stamped ${markerCount} marker(s) in ${rel}`);
    } else {
      lines.push(`${rel} already in sync (${markerCount} marker(s))`);
    }
  }
  return { changed, lines };
}

if (import.meta.main) {
  if (process.argv.includes("--stamp-docs")) {
    const { changed, lines } = stampDocs();
    for (const l of lines) console.log(`[size-gate --stamp-docs] ${l}`);
    console.log(`[size-gate --stamp-docs] ${changed.length === 0 ? "✓ docs already in sync" : `✓ ${changed.length} file(s) re-stamped`} with ceiling ${TREE_CEILING.toLocaleString("en-US")} LOC`);
    process.exit(0);
  }
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
