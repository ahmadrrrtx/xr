/**
 * XR 5.1 — Vision environment provider: governed observations.
 *
 * Vision perceives; it never executes. Every observation is a typed evidence
 * record with provenance, confidence, sensitivity, and staleness — attached to
 * a session so later coordinate actions can cite a FRESH observation.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { captureScreen, ocrImage } from "../../../control/vision.ts";
import { checkCloudConsent } from "../privacy.ts";
import { ENVIRONMENT_BOUNDS, type EnvironmentObservation, type EnvironmentSession } from "../types.ts";

function hashFile(path: string): { path: string; sha256: string; bytes: number } | null {
  try {
    const buf = readFileSync(path);
    return { path, sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.byteLength };
  } catch {
    return null;
  }
}

/** Capture the screen as a governed observation (artifact ref, no blob retention). */
export async function observeScreen(session?: EnvironmentSession): Promise<EnvironmentObservation> {
  const cap = await captureScreen();
  const now = Date.now();
  if (!cap.ok || !cap.path) {
    return {
      observationId: `obs_fail_${randomUUID().slice(0, 8)}`,
      sessionId: session?.sessionId,
      source: "screen",
      summary: `screen capture failed: ${cap.message}`.slice(0, ENVIRONMENT_BOUNDS.MAX_OBSERVATION_SUMMARY_CHARS),
      confidence: "unknown",
      provenance: "screenshot",
      sensitivity: "unknown",
      capturedAt: now,
      staleAfterMs: ENVIRONMENT_BOUNDS.DEFAULT_STALE_OBSERVATION_MS,
    };
  }
  const artifact = hashFile(cap.path) ?? undefined;
  return {
    observationId: `obs_screen_${now}`,
    sessionId: session?.sessionId,
    source: "screen",
    summary: `screen capture (${artifact ? `${artifact.bytes} bytes` : "unreadable"})`,
    confidence: artifact ? "high" : "low",
    provenance: "screenshot",
    artifact,
    // Honest: we cannot detect sensitive regions; the whole screen may contain them.
    sensitivity: "private",
    capturedAt: now,
    staleAfterMs: ENVIRONMENT_BOUNDS.DEFAULT_STALE_OBSERVATION_MS,
  };
}

/** Register an already-captured screen artifact as a governed observation. */
export function observeArtifact(imagePath: string, session?: EnvironmentSession): EnvironmentObservation {
  const now = Date.now();
  const artifact = hashFile(imagePath) ?? undefined;
  return {
    observationId: `obs_screen_${now}`,
    sessionId: session?.sessionId,
    source: "screen",
    summary: `screen capture (${artifact ? `${artifact.bytes} bytes` : "unreadable"})`,
    confidence: artifact ? "high" : "unknown",
    provenance: "screenshot",
    artifact,
    sensitivity: "private",
    capturedAt: now,
    staleAfterMs: ENVIRONMENT_BOUNDS.DEFAULT_STALE_OBSERVATION_MS,
  };
}

/** Local OCR observation of an image (tesseract only — never leaves the device). */
export async function observeOcr(imagePath: string, session?: EnvironmentSession): Promise<EnvironmentObservation> {
  const now = Date.now();
  const artifact = hashFile(imagePath) ?? undefined;
  const text = await ocrImage(imagePath);
  const available = text !== "[OCR unavailable]";
  return {
    observationId: `obs_ocr_${now}`,
    sessionId: session?.sessionId,
    source: "image",
    summary: available
      ? `ocr: ${text.length} chars extracted locally`
      : "ocr unavailable (tesseract missing) — no cloud fallback attempted",
    confidence: available ? (text.length > 0 ? "medium" : "low") : "unknown",
    provenance: "ocr",
    artifact,
    sensitivity: "unknown",
    capturedAt: now,
    staleAfterMs: ENVIRONMENT_BOUNDS.DEFAULT_STALE_OBSERVATION_MS,
  };
}

export interface VisionRoutingDecision {
  route: "local" | "cloud" | "blocked";
  reason: string;
}

/**
 * Decide where a vision model call may go. Local providers always allowed;
 * cloud requires settings AND session policy consent (§7.6, §11).
 */
export function decideVisionRouting(params: {
  providerIsLocal: boolean;
  settingsAllowCloud: boolean;
  sessionPolicyAllowCloud: boolean;
}): VisionRoutingDecision {
  if (params.providerIsLocal) return { route: "local", reason: "local provider — no image leaves the device" };
  const consent = checkCloudConsent("vision", params.settingsAllowCloud, params.sessionPolicyAllowCloud);
  if (consent.allowed) return { route: "cloud", reason: "explicit cloud-vision consent in settings and session policy" };
  return { route: "blocked", reason: consent.reason ?? "cloud vision not consented" };
}
