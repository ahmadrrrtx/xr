/**
 * XR 5.1 — Environment Interaction OS: the governed entry point.
 *
 * Every consequential browser/desktop/filesystem/application/voice/vision
 * action passes through runEnvironmentAction:
 *
 *   kill-switch → schema → environment compatibility → target/evidence proof →
 *   privacy/consent → risk + reversibility + approval strength → permission →
 *   session lifecycle → stale-observation check → execute (via the existing
 *   control flow) → bounded recovery → circuit → durable record.
 *
 * It never bypasses the control system: execution is delegated to
 * control.runAction with an optional execOverride for governed browser
 * sessions, so kill-switch, permissions, risk classification, approval racing
 * (CLI + dashboard), readiness checks, and audit all keep single ownership.
 */
import { randomUUID } from "node:crypto";
import type { Store } from "../state/workspace-store.ts";
import { loadConfig, XR_HOME } from "../config/config.ts";
import { runAction } from "../control/service.ts";
import type { Action, ControlOptions, ExecutionMode } from "../control/types.ts";
import { isLocal } from "../cost/pricing.ts";
import {
  EnvironmentActionRequestSchema,
  ENVIRONMENT_BOUNDS,
  TERMINAL_ENVIRONMENT_STATES,
  defaultEnvironmentPolicy,
  type EnvironmentActionRecord,
  type EnvironmentActionRequest,
  type EnvironmentAssessment,
  type EnvironmentObservation,
  type EnvironmentOutcome,
  type EnvironmentSession,
  type EnvironmentType,
} from "./types.ts";
import { assessEnvironmentAction, environmentForAction } from "./classify.ts";
import { transitionSession, environmentSessions, EnvironmentSessionRegistry } from "./lifecycle.ts";
import { environmentObservations } from "./observations.ts";
import {
  auditAssessed,
  auditCircuit,
  auditPrivacyBlock,
  auditQuarantine,
  auditRecord,
  auditRecovery,
  auditSessionClosed,
  auditSessionCreated,
  auditSessionTransition,
} from "./audit.ts";
import { redactEnvironmentAction } from "./privacy.ts";
import { decideRecovery, newRecoveryBudget, recordOutcomeOnCircuit, type RecoveryBudgetState } from "./recovery.ts";
import { detectEnvironmentCapabilities, capabilityFor, probePlaywright } from "./capabilities.ts";
import * as browserProvider from "./providers/browser.ts";
import * as visionProvider from "./providers/vision.ts";
import * as desktopProvider from "./providers/desktop.ts";
import * as fsProvider from "./providers/filesystem.ts";
import { gateVoiceControlAction, type VoiceGateDecision } from "./providers/voice.ts";

// ── Kill switches (§17 rollback granularity) ──────────────────────────────

export interface EnvironmentDisableState {
  disabled: boolean;
  reason?: string;
  modalityDisabled?: EnvironmentType;
}

export function getEnvironmentConfig() {
  try {
    const { config } = loadConfig();
    return config.environment;
  } catch {
    return undefined;
  }
}

export function environmentDisabled(env?: EnvironmentType): EnvironmentDisableState {
  if (process.env.XR_ENVIRONMENT_DISABLED === "1") {
    return { disabled: true, reason: "XR_ENVIRONMENT_DISABLED=1 in environment" };
  }
  const cfg = getEnvironmentConfig();
  if (cfg && cfg.enabled === false) {
    return { disabled: true, reason: "environment.enabled is false in config.json" };
  }
  if (env && cfg?.modalities && (cfg.modalities as Record<string, boolean>)[env] === false) {
    return {
      disabled: true,
      reason: `environment.modalities.${env} is false in config.json`,
      modalityDisabled: env,
    };
  }
  return { disabled: false };
}

// ── Records (bounded in-memory history; durable trail lives in Store.audit) ──

const MAX_RECORDS = 200;
const records: EnvironmentActionRecord[] = [];

function pushRecord(record: EnvironmentActionRecord): void {
  records.push(record);
  if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
}

export function environmentHistory(limit = 50): EnvironmentActionRecord[] {
  return records.slice(-Math.max(1, Math.min(MAX_RECORDS, limit))).reverse();
}

export function _clearEnvironmentHistory(): void {
  records.length = 0;
}

// ── Options ───────────────────────────────────────────────────────────────

export interface RunEnvironmentOptions {
  workspaceId?: string;
  mode?: ExecutionMode;
  /** Auto-approve sensitive (maps to control --yes). NEVER honored for strong approvals. */
  yes?: boolean;
  delayMs?: number;
  /** Voice-sourced requests carry parser confidence + confirmation policy. */
  voice?: { confidence: number; confirmationPolicy: "always-risky" | "always" | "never-execute-risky" };
  taskId?: string;
}

export interface RunEnvironmentResult {
  record: EnvironmentActionRecord;
  /** Human/screen-reader friendly one-liner (progressive disclosure). */
  display: string;
  /** Spoken refusal line for voice callers, when the voice gate refused. */
  spokenRefusal?: string;
}

// ── Sessions ──────────────────────────────────────────────────────────────

function configSessionLimits(): { maxActive: number; idleTimeoutMs: number } {
  const cfg = getEnvironmentConfig();
  return {
    maxActive: cfg?.sessions?.maxActive ?? ENVIRONMENT_BOUNDS.MAX_ACTIVE_SESSIONS,
    idleTimeoutMs: cfg?.sessions?.idleTimeoutMs ?? ENVIRONMENT_BOUNDS.IDLE_SESSION_TIMEOUT_MS,
  };
}

export function openEnvironmentSession(params: {
  store?: Store;
  type: EnvironmentType;
  workspaceId: string;
  taskId?: string;
  policyOverrides?: Partial<ReturnType<typeof defaultEnvironmentPolicy>>;
}): { ok: true; session: EnvironmentSession } | { ok: false; reason: string } {
  const kill = environmentDisabled(params.type);
  if (kill.disabled) return { ok: false, reason: kill.reason ?? "environment disabled" };
  const limits = configSessionLimits();
  (environmentSessions as EnvironmentSessionRegistry).configureLimits?.(limits);
  const cfg = getEnvironmentConfig();
  const sessionIdSeed = randomUUID().slice(0, 10);
  const policy = {
    ...defaultEnvironmentPolicy(XR_HOME, `seed_${sessionIdSeed}`),
    allowCloudVision: cfg?.vision?.allowCloud ?? false,
    blockPrivateNetworks: cfg?.browser?.blockPrivateNetworks ?? true,
    allowedDomains: [...(cfg?.browser?.allowedDomains ?? [])],
    blockedDomains: [...(cfg?.browser?.blockedDomains ?? [])],
    maxDownloadBytes: cfg?.browser?.maxDownloadBytes ?? 50 * 1024 * 1024,
    ...params.policyOverrides,
  };
  let session: EnvironmentSession;
  try {
    session = environmentSessions.create({
      type: params.type,
      workspaceId: params.workspaceId,
      policy,
      taskId: params.taskId,
    });
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  // Fix the downloads root now that the real session id exists.
  session.policy.downloadsRoot = `${XR_HOME}/browser/${session.sessionId}/downloads`;
  auditSessionCreated(params.store, session);
  transitionSession(session, "provision", "session open requested");
  auditSessionTransition(params.store, session, "provision");
  return { ok: true, session };
}

async function provisionSession(store: Store | undefined, session: EnvironmentSession): Promise<{ ok: boolean; error?: string }> {
  if (session.type === "browser") {
    const res = await browserProvider.provisionBrowser(session);
    if (!res.ok) {
      transitionSession(session, "failed", res.error);
      auditSessionTransition(store, session, "failed", res.error);
      return { ok: false, error: res.error };
    }
  }
  // desktop/application/filesystem/voice/vision sessions need no provisioning —
  // their primitives are per-action; the session exists for scoping/limits.
  const t = transitionSession(session, "ready", "provisioned");
  if (t.ok) auditSessionTransition(store, session, "ready");
  return { ok: t.ok, error: t.reason };
}

export async function closeEnvironmentSession(
  store: Store | undefined,
  sessionId: string,
  reason = "close requested",
): Promise<{ ok: boolean; note?: string }> {
  const session = environmentSessions.get(sessionId);
  if (!session) return { ok: false, note: `unknown session ${sessionId}` };
  if (TERMINAL_ENVIRONMENT_STATES.has(session.state)) return { ok: true, note: `session already ${session.state}` };

  if (session.state !== "closing") {
    transitionSession(session, "closing", reason);
    auditSessionTransition(store, session, "closing", reason);
  }
  session.cleanupState = "pending";
  let cleanupOk = true;
  let note: string | undefined;
  if (session.type === "browser") {
    const res = await browserProvider.cleanupBrowser(session);
    cleanupOk = res.ok;
    note = res.note;
  }
  session.cleanupState = cleanupOk ? "succeeded" : "failed";
  // Cleanup defects quarantine the session (§8 durable integration / §17).
  const terminal = cleanupOk ? "closed" : "quarantined";
  const t = transitionSession(session, terminal, cleanupOk ? reason : `cleanup failed: ${note ?? "unknown"}`);
  if (t.ok) {
    auditSessionClosed(store, session, session.cleanupState, note);
    if (!cleanupOk) auditQuarantine(store, session, `cleanup failed: ${note ?? "unknown"}`);
  }
  return { ok: true, note };
}

export function listEnvironmentSessions(workspaceId?: string): EnvironmentSession[] {
  return environmentSessions.list(workspaceId);
}

// ── Capability gate ───────────────────────────────────────────────────────

async function capabilityBlock(env: EnvironmentType, action: Action): Promise<string | undefined> {
  switch (env) {
    case "browser": {
      const pw = await probePlaywright();
      if (!pw.available) return `browser unsupported: ${pw.detail}`;
      return undefined;
    }
    case "desktop": {
      const s = desktopProvider.desktopSupportFor(action);
      return s.ok ? undefined : s.reason;
    }
    case "application": {
      const s = desktopProvider.applicationSupportFor();
      return s.ok ? undefined : s.reason;
    }
    case "filesystem":
      return undefined; // node fs is always available; permissions gate below
    case "vision":
      return undefined; // observation only; provider reports its own failures
    case "voice":
      return undefined; // voice is an interface; mapped env check already ran
  }
}

// ── The governed entry ────────────────────────────────────────────────────

export async function runEnvironmentAction(
  store: Store,
  rawRequest: unknown,
  opts: RunEnvironmentOptions = {},
): Promise<RunEnvironmentResult> {
  const startedAt = Date.now();
  const workspaceId = opts.workspaceId ?? process.cwd();

  const finish = (
    partial: Omit<EnvironmentActionRecord, "recordId" | "startedAt" | "endedAt" | "durationMs">,
    spokenRefusal?: string,
  ): RunEnvironmentResult => {
    const endedAt = Date.now();
    const record: EnvironmentActionRecord = {
      recordId: `envact_${randomUUID().slice(0, 10)}`,
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      ...partial,
    };
    pushRecord(record);
    auditRecord(store, record);
    return {
      record,
      spokenRefusal,
      display: `${record.outcome} · ${record.environment}/${record.interaction} · ${record.riskLevel} risk · ${record.reversibility} · ${record.message}`,
    };
  };

  // 1. Parse.
  const parsed = EnvironmentActionRequestSchema.safeParse(rawRequest);
  if (!parsed.success) {
    return finish({
      sessionId: undefined,
      environment: "desktop",
      sourceActor: "cli",
      actionSummary: "(invalid request)",
      interaction: "structural",
      target: { kind: "none" },
      riskLevel: "safe",
      riskReason: "invalid request schema",
      reversibility: "unknown",
      compensation: { scope: "none", description: "n/a" },
      approval: { required: "none", granted: false },
      outcome: "blocked",
      message: `invalid environment action request: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      evidenceRefs: [],
    });
  }
  const request: EnvironmentActionRequest = parsed.data;
  const action = request.action;
  const env: EnvironmentType = request.environment === "voice" ? environmentForAction(action) : request.environment;
  const actionSummary = JSON.stringify(redactEnvironmentAction(action)).slice(0, 500);

  const finishFor = (
    outcome: EnvironmentOutcome,
    message: string,
    assessment: EnvironmentAssessment,
    extra?: Partial<EnvironmentActionRecord>,
    spokenRefusal?: string,
  ) =>
    finish(
      {
        sessionId: extra?.sessionId,
        environment: request.environment,
        sourceActor: request.sourceActor,
        actionSummary,
        interaction: assessment.interaction,
        target: request.target,
        riskLevel: assessment.risk.level,
        riskReason: assessment.risk.reason,
        reversibility: assessment.reversibility,
        compensation: assessment.compensation,
        approval: extra?.approval ?? {
          required: assessment.approval,
          // Dry-run never executes, so it can never claim a granted approval.
          granted: outcome === "succeeded" && !request.dryRun && assessment.approval !== "none",
        },
        observation: extra?.observation,
        recovery: extra?.recovery,
        outcome,
        message,
        evidenceRefs: extra?.evidenceRefs ?? [],
        cleanupNote: extra?.cleanupNote,
      },
      spokenRefusal,
    );

  // 2. Kill switches (whole layer + modality).
  const kill = environmentDisabled(env);
  if (kill.disabled) {
    const dummyAssessment = assessEnvironmentAction(request);
    auditAssessed(store, dummyAssessment);
    return finishFor("blocked", `environment interaction is disabled (${kill.reason})`, dummyAssessment);
  }

  // 3. Deterministic assessment (risk / reversibility / approval / compatibility).
  const assessment = assessEnvironmentAction(request);
  auditAssessed(store, assessment);
  if (assessment.blockedReason) {
    return finishFor("blocked", assessment.blockedReason, assessment);
  }

  // 4. Stale observation check for coordinate/vision-guided actions. This is a
  //    deterministic property of perception freshness, so it runs before the
  //    platform capability gate: acting on a stale screen is wrong everywhere.
  let observationNote: EnvironmentActionRecord["observation"];
  if (request.observationRef) {
    const check = environmentObservations.check(request.observationRef);
    if (!check.ok) {
      return finishFor("blocked", check.reason, assessment, {
        observation: { ref: request.observationRef, confidence: request.confidence, stale: true },
      });
    }
    observationNote = { ref: request.observationRef, confidence: check.observation.confidence, stale: false };
  }

  // 5. Capability gate — fail closed on unsupported platforms, never degrade silently.
  const capReason = await capabilityBlock(env, action);
  if (capReason) {
    return finishFor("blocked", capReason, assessment);
  }

  // 6. Voice gate (§7.5): confidence threshold, confirmation policy, stronger channel.
  let voiceDecision: VoiceGateDecision | undefined;
  if (request.sourceActor === "voice") {
    const vcfg = getEnvironmentConfig()?.voice;
    voiceDecision = gateVoiceControlAction({
      confidence: opts.voice?.confidence ?? 0,
      confirmationPolicy: opts.voice?.confirmationPolicy ?? "always-risky",
      minControlConfidence: vcfg?.minControlConfidence,
      action,
      approvalStrength: assessment.approval,
    });
    if (!voiceDecision.allowed) {
      auditPrivacyBlock(store, "voice_gate", voiceDecision.reason ?? "voice gate refused");
      return finishFor("denied", voiceDecision.reason ?? "voice gate refused", assessment, undefined, voiceDecision.spokenRefusal);
    }
  }

  // 7. Session (browser actions REQUIRE an isolated governed session).
  let session: EnvironmentSession | undefined;
  if (env === "browser") {
    if (request.sessionId) {
      const usable = environmentSessions.requireUsable(request.sessionId);
      if (!usable.ok) return finishFor("blocked", usable.reason, assessment, { sessionId: request.sessionId });
      session = usable.session;
    } else {
      const opened = openEnvironmentSession({
        store,
        type: "browser",
        workspaceId,
        taskId: opts.taskId ?? request.taskId,
      });
      if (!opened.ok) return finishFor("blocked", opened.reason, assessment);
      session = opened.session;
      const prov = await provisionSession(store, session);
      if (!prov.ok) return finishFor("blocked", prov.error ?? "browser provisioning failed", assessment, { sessionId: session.sessionId });
    }
    if (session.state === "ready") {
      transitionSession(session, "active", "first action");
      auditSessionTransition(store, session, "active");
    }
    if (session.circuitOpenUntil && Date.now() < session.circuitOpenUntil) {
      const waitS = Math.ceil((session.circuitOpenUntil - Date.now()) / 1000);
      return finishFor("blocked", `circuit breaker open after repeated failures; retry in ~${waitS}s`, assessment, {
        sessionId: session.sessionId,
      });
    }
    // Browser "close" op maps to governed session closure, not a page op.
    if (action.type === "browser" && action.op === "close") {
      const closed = await closeEnvironmentSession(store, session.sessionId, "browser close action");
      return finishFor(closed.ok ? "succeeded" : "failed", closed.ok ? "browser session closed and cleaned" : `close failed: ${closed.note}`, assessment, {
        sessionId: session.sessionId,
        cleanupNote: closed.note ?? "session cleanup succeeded",
      });
    }
  } else if (request.sessionId) {
    const usable = environmentSessions.requireUsable(request.sessionId);
    if (!usable.ok) return finishFor("blocked", usable.reason, assessment, { sessionId: request.sessionId });
    session = usable.session;
  }

  // 8. Compensation pre-image (filesystem write/mkdir/move).
  let compensationNote: string | undefined;
  if (env === "filesystem" && action.type === "file") {
    const pre = await fsProvider.capturePreImage(action, workspaceId).catch(() => null);
    if (pre) compensationNote = fsProvider.describeCompensation(pre);
  }

  // 9. Execute through the existing control flow (all its gates stay authoritative).
  const controlOpts: ControlOptions = {
    mode: request.dryRun ? "dry-run" : assessment.approval === "strong" ? "step" : (opts.mode ?? "auto"),
    // Strong approvals NEVER honor auto-approve.
    autoApproveSensitive: assessment.approval === "strong" ? false : (opts.yes ?? false),
    delayMs: opts.delayMs,
    execOverride:
      env === "browser" && session
        ? async (a) => browserProvider.runBrowserOp(session!, a)
        : undefined,
  };

  const budget: RecoveryBudgetState = newRecoveryBudget();
  const rcfg = getEnvironmentConfig()?.recovery;
  let recoveryInfo: EnvironmentActionRecord["recovery"];
  let run = await runAction(store, action, controlOpts);

  // 10. Bounded recovery: at most one re-observe retry, never for irreversible/unknown.
  if (!run.result.ok && !run.result.skipped) {
    const decision = decideRecovery({
      failureMessage: run.result.message,
      reversibility: assessment.reversibility,
      sideEffectUnknown: /crashed|target closed|detached/i.test(run.result.message),
      budget,
      session,
      maxRetries: rcfg?.maxReobserveRetries ?? ENVIRONMENT_BOUNDS.MAX_REOBSERVE_RETRIES,
    });
    if (decision.retry) {
      budget.retriesUsed++;
      auditRecovery(store, session?.sessionId, { kind: "reobserve_retry", reason: decision.reason });
      // Mandatory re-observation before retrying.
      const reObs = env === "browser" && session
        ? await browserProvider.observeBrowser(session)
        : await visionProvider.observeScreen(session);
      if (reObs) environmentObservations.put(reObs);
      run = await runAction(store, action, controlOpts);
      recoveryInfo = {
        attempted: true,
        kind: "reobserve_retry",
        budgetUsed: budget.retriesUsed,
        circuitOpen: !!(session?.circuitOpenUntil && Date.now() < session.circuitOpenUntil),
      };
    } else {
      recoveryInfo = { attempted: false, budgetUsed: budget.retriesUsed };
      auditRecovery(store, session?.sessionId, { kind: "no_retry", reason: decision.reason });
    }
  }

  // 11. Circuit + session bookkeeping.
  if (session) {
    session.actionsPerformed++;
    session.lastActionAt = Date.now();
    const circuit = recordOutcomeOnCircuit(session, run.result.ok, Date.now(), {
      threshold: rcfg?.circuitFailures,
      cooldownMs: rcfg?.circuitCooldownMs,
    });
    if (circuit.opened) {
      auditCircuit(store, session.sessionId, { opened: true, reason: circuit.reason, cooldownUntil: circuit.cooldownUntil });
    }
    if (session.actionsPerformed >= ENVIRONMENT_BOUNDS.MAX_ACTIONS_PER_SESSION) {
      await closeEnvironmentSession(store, session.sessionId, "session action budget exhausted");
    }
  }

  // 12. Outcome mapping (uncertain = side effect unknown, always surfaced).
  let outcome: EnvironmentOutcome;
  const msg = run.result.message;
  if (run.result.ok) {
    outcome = "succeeded";
  } else if (run.result.skipped && /denied/i.test(msg)) {
    outcome = "denied";
  } else if (run.result.skipped && /disabled|permission|not granted|forbidden/i.test(msg)) {
    outcome = "blocked";
  } else if (/crashed|target closed|detached/i.test(msg) && (assessment.reversibility === "irreversible" || assessment.reversibility === "unknown")) {
    outcome = "uncertain";
  } else {
    outcome = "failed";
  }

  const evidenceRefs: string[] = [];
  if (request.observationRef) evidenceRefs.push(request.observationRef);
  if (run.result.data && typeof run.result.data === "object" && "path" in (run.result.data as Record<string, unknown>)) {
    evidenceRefs.push(`artifact:${(run.result.data as Record<string, unknown>).path}`);
  }
  // §8 context integration: extracted web content is untrusted evidence with
  // provenance — it enters context as `untrusted_external`, never instructions.
  if (action.type === "browser" && action.op === "extract") {
    evidenceRefs.push(`context:untrusted_external:${session?.sessionId ?? "no-session"}`);
  }

  const finalMessage = request.dryRun && run.result.ok ? `${msg} (dry-run — simulated, nothing executed)` : msg;
  const result = finishFor(outcome, finalMessage, assessment, {
    sessionId: session?.sessionId,
    observation: observationNote,
    recovery: recoveryInfo,
    evidenceRefs,
    cleanupNote: compensationNote ? `compensation available: ${compensationNote}` : undefined,
  });
  return result;
}

// ── Observation entry (vision model, §7.6) ────────────────────────────────

export interface ObserveOptions {
  source: "screen" | "browser" | "ocr" | "artifact";
  sessionId?: string;
  imagePath?: string;
}

export async function observeEnvironment(
  store: Store | undefined,
  opts: ObserveOptions,
): Promise<{ ok: boolean; observation?: EnvironmentObservation; reason?: string }> {
  const kill = environmentDisabled("vision");
  if (kill.disabled) return { ok: false, reason: kill.reason };
  let observation: EnvironmentObservation | null = null;
  if (opts.source === "screen") {
    observation = await visionProvider.observeScreen(opts.sessionId ? environmentSessions.get(opts.sessionId) : undefined);
  } else if (opts.source === "artifact") {
    if (!opts.imagePath) return { ok: false, reason: "artifact observation needs imagePath" };
    observation = visionProvider.observeArtifact(opts.imagePath, opts.sessionId ? environmentSessions.get(opts.sessionId) : undefined);
  } else if (opts.source === "ocr") {
    if (!opts.imagePath) return { ok: false, reason: "ocr observation needs imagePath" };
    observation = await visionProvider.observeOcr(opts.imagePath, opts.sessionId ? environmentSessions.get(opts.sessionId) : undefined);
  } else if (opts.source === "browser") {
    if (!opts.sessionId) return { ok: false, reason: "browser observation needs sessionId" };
    const usable = environmentSessions.requireUsable(opts.sessionId);
    if (!usable.ok) return { ok: false, reason: usable.reason };
    if (usable.session.type !== "browser") return { ok: false, reason: "session is not a browser session" };
    observation = await browserProvider.observeBrowser(usable.session);
    if (!observation) return { ok: false, reason: "no live browser page to observe" };
  }
  if (!observation) return { ok: false, reason: "observation failed" };
  environmentObservations.put(observation);
  store?.audit("env.observation", {
    observationId: observation.observationId,
    sessionId: observation.sessionId ?? null,
    source: observation.source,
    provenance: observation.provenance,
    confidence: observation.confidence,
    sensitivity: observation.sensitivity,
    summary: observation.summary.slice(0, 500),
  });
  return { ok: true, observation };
}

// ── Status / inspection ───────────────────────────────────────────────────

export async function environmentStatus(): Promise<Record<string, unknown>> {
  const caps = await detectEnvironmentCapabilities();
  const sessions = environmentSessions.list();
  const browserSessions = sessions
    .filter((s) => s.type === "browser")
    .map((s) => ({ sessionId: s.sessionId, state: s.state, report: browserProvider.browserSessionReport(s) }));
  return {
    enabled: !environmentDisabled().disabled,
    config: getEnvironmentConfig() ?? null,
    capabilities: caps,
    sessions: sessions.map((s) => ({
      sessionId: s.sessionId,
      type: s.type,
      state: s.state,
      workspaceId: s.workspaceId,
      actionsPerformed: s.actionsPerformed,
      consecutiveFailures: s.consecutiveFailures,
      circuitOpenUntil: s.circuitOpenUntil,
      cleanupState: s.cleanupState,
      quarantineReason: s.quarantineReason,
      createdAt: s.createdAt,
    })),
    browserSessions,
    recentRecords: environmentHistory(20),
  };
}

/** Locality-aware vision routing (Phase 5 consume, no routing changes). */
export function visionCloudDecision(providerId: string): { route: "local" | "cloud" | "blocked"; reason: string } {
  return visionProvider.decideVisionRouting({
    providerIsLocal: isLocal(providerId),
    settingsAllowCloud: getEnvironmentConfig()?.vision?.allowCloud ?? false,
    sessionPolicyAllowCloud: true, // session policies cannot raise above settings
  });
}

export { capabilityFor, detectEnvironmentCapabilities };
