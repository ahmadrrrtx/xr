/*
 * XR-P01 — engine diagnostics export: the copyable bundle a user pastes
 * into a bug report when the engine link is unhealthy.
 *
 * Secrecy is BY CONSTRUCTION, not by filter:
 *   · The bundle is built from an ALLOW-LIST of named fields only
 *     (DIAGNOSTICS_FIELDS). The transport token, provider keys, chat
 *     content, file paths and settings are not parameters to the builder
 *     and cannot appear unless a later edit adds them here, in review.
 *   · The one free-text input — the sidecar stderr tail, read over the
 *     existing Rust `engine_logs_tail` command — is UNTRUSTED (the engine
 *     prints dashboard URLs; a plugin could print anything), so every
 *     line is additionally redacted before it enters the bundle.
 * No engine call is made and no state changes: observing never mutates.
 */
import { APP_VERSION } from '@/lib/appMeta';
import { isTauri } from '@/lib/tauri';
import {
  engineVersion,
  useEngineStore,
  type EngineFailureReason,
  type EngineStatus,
} from '@/stores/engineStore';
import type { EngineVia } from '@/engine/transport';

/** The complete allow-list of fields a diagnostics bundle may contain. */
export const DIAGNOSTICS_FIELDS = [
  'generatedAt',
  'appVersion',
  'engineVersion',
  'contractVersion',
  'readiness',
  'endpointVia',
  'endpointPort',
  'endpointReason',
  'consecutiveFailures',
  'lastError',
  'stderrSource',
  'stderrTail',
] as const;

export type StderrSource =
  | 'sidecar-stderr'
  | 'not-available-outside-tauri'
  | 'not-available-ipc-error';

export interface EngineDiagnosticsInput {
  generatedAt: string;
  appVersion: string;
  engineVersion: string | null;
  /** e.g. "1", "not reported (legacy engine)", "not observed". */
  contractVersion: string;
  status: EngineStatus;
  failureReason: EngineFailureReason | null;
  endpointVia: EngineVia | null;
  endpointPort: number | null;
  endpointReason: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  stderrSource: StderrSource;
  stderrTail: string[];
}

const REDACTED = '<redacted>';

/**
 * Redact credential-shaped substrings from UNTRUSTED free text (stderr,
 * error strings). Defense in depth on top of the allow-list: the daemon
 * never intentionally prints its token on stderr and `engine_state.rs`
 * refuses to parse `?token=` dashboard lines, but a diagnostic bundle
 * will be pasted into public trackers, so assume the line is hostile.
 */
export function redactDiagnosticText(text: string): string {
  return text
    .replace(/Authorization:\s*\S+(?:\s+\S+)?/gi, `Authorization: ${REDACTED}`)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/([?&](?:token|api[_-]?key|key|secret)=)[^\s&]+/gi, `$1${REDACTED}`)
    .replace(/\b(?:token|api[_-]?key|apikey|secret)\b\s*[:=]\s*\S+/gi, (m) =>
      m.replace(/[:=].*$/, (eq) => `${eq.startsWith(':') ? ': ' : '='}${REDACTED}`),
    )
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\b[0-9a-f]{48}\b/gi, REDACTED); // the daemon token's exact shape
}

/** Build the bundle from allow-listed fields ONLY. Pure (specimen-tested). */
export function buildEngineDiagnostics(input: EngineDiagnosticsInput): string {
  const readiness =
    input.status === 'failed'
      ? `failed(${input.failureReason ?? 'unreachable'})`
      : input.status;
  const lines: string[] = [
    'XR engine diagnostics (XR-P01 — allow-listed fields, redacted)',
    `generatedAt: ${input.generatedAt}`,
    `appVersion: ${input.appVersion}`,
    `engineVersion: ${input.engineVersion ?? 'not observed'}`,
    `contractVersion: ${input.contractVersion}`,
    `readiness: ${readiness}`,
    `endpointVia: ${input.endpointVia ?? 'none resolved'}`,
    `endpointPort: ${input.endpointPort ?? 'n/a'}`,
    `endpointReason: ${input.endpointReason ? redactDiagnosticText(input.endpointReason) : 'none'}`,
    `consecutiveFailures: ${input.consecutiveFailures}`,
    `lastError: ${input.lastError ? redactDiagnosticText(input.lastError) : 'none'}`,
    `stderrSource: ${input.stderrSource}`,
    'stderrTail (untrusted engine output, redacted):',
    ...(input.stderrTail.length
      ? input.stderrTail.map((l) => `  ${redactDiagnosticText(l)}`)
      : ['  (none)']),
  ];
  return lines.join('\n');
}

/**
 * Collect the bundle from live store state + the shell's stderr tail.
 * Outside Tauri there is no sidecar, so the tail is honestly reported as
 * unavailable (dev engines print to the developer's terminal).
 */
export async function collectEngineDiagnostics(): Promise<string> {
  const s = useEngineStore.getState();
  let stderrTail = s.stderrTail;
  let stderrSource: StderrSource = 'not-available-outside-tauri';
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      stderrTail = await invoke<string[]>('engine_logs_tail', { lines: 40 });
      stderrSource = 'sidecar-stderr';
    } catch {
      stderrSource = 'not-available-ipc-error';
    }
  }
  const contractVersion =
    s.handshake?.kind === 'ok'
      ? String(s.handshake.contractVersion)
      : s.handshake?.kind === 'legacy'
        ? 'not reported (legacy engine)'
        : 'not observed';
  return buildEngineDiagnostics({
    generatedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    engineVersion: engineVersion(),
    contractVersion,
    status: s.status,
    failureReason: s.failureReason,
    endpointVia: s.endpoint?.via ?? null,
    endpointPort: s.endpoint?.port ?? null,
    endpointReason: s.endpoint?.reason ?? null,
    consecutiveFailures: s.failures,
    lastError: s.lastError,
    stderrSource,
    stderrTail,
  });
}

/** Copy the bundle, reporting honestly when the platform refuses. */
export async function copyEngineDiagnostics(): Promise<{ ok: boolean; text: string; message: string }> {
  const text = await collectEngineDiagnostics();
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true, text, message: 'Diagnostics copied — no tokens or keys included.' };
  } catch {
    return { ok: false, text, message: 'Clipboard unavailable here — the bundle is shown below to copy manually.' };
  }
}
