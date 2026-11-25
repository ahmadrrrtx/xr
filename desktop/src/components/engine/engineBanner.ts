/*
 * Engine-down decisions (XR-P01 copy, NEW-22), kept free of React so they are unit-tested directly
 * (test/desktop/engine-banner-start.test.ts).
 *
 * NEW-22: in the packaged app, nothing on screen could start an engine that was down. The banner's and the chat
 * error card's Start/Restart buttons required `endpoint.via === 'sidecar'`, which only a live, paired sidecar has,
 * and "Retry" only probes again. A launch that deliberately skipped the engine (crash recovery's "start without the
 * engine", honoured once) was also titled "Engine crashed.". The owner's first Preview 5 launch hit both.
 */
import type { EngineFailureReason, EngineStatus } from '@/stores/engineStore';

/**
 * The shell's note when it deliberately does not spawn the sidecar for this launch
 * (`engine::skip_spawn` in desktop/src-tauri/src/lib.rs). The test pins it to the Rust literal.
 */
export const ENGINE_SKIPPED_REASON = 'recovery: starting without the local engine';

/**
 * Whether Start/Restart can be offered. The dev server can launch an engine, and inside the packaged app the shell
 * can always (re)spawn its own sidecar: `engine_restart` answers with a clear error when the build has none. Whether
 * an engine was ever paired is irrelevant: that is exactly the state in which the user needs the button.
 */
export function canStartEngine(env: { dev: boolean; tauri: boolean }): boolean {
  return env.dev || env.tauri;
}

export function bannerCopy(
  status: EngineStatus,
  reason: EngineFailureReason | null,
  lastError: string | null,
  bootDeadlineMs: number,
): { title: string; detail: string } {
  if (status === 'degraded') {
    return {
      title: 'Engine connected — contract unverified.',
      detail:
        lastError ??
        'This engine does not report a contract version, so the desktop cannot verify it matches. Restart with the bundled engine, or run `xr serve` from a current install.',
    };
  }
  if (status === 'failed') {
    switch (reason) {
      case 'unauthorized':
        return {
          title: 'Engine rejected the session.',
          detail: 'Restart the engine to issue a new token and re-pair.',
        };
      case 'incompatible':
        return {
          title: 'Engine version is incompatible.',
          detail: lastError ?? 'Update the engine or the desktop app so their contracts match.',
        };
      case 'crashed':
        if (lastError === ENGINE_SKIPPED_REASON) {
          return {
            title: 'Engine not started.',
            detail: 'XR opened without its local engine this time (a crash-recovery choice). Start it to chat.',
          };
        }
        return {
          title: 'Engine crashed.',
          detail: lastError ?? 'The engine process failed to start. Its last output is in Diagnostics.',
        };
      case 'timeout':
        return {
          title: 'Engine did not answer in time.',
          detail: `No answer within ${Math.round(bootDeadlineMs / 1000)} s. Its last output is in Diagnostics.`,
        };
      default:
        return {
          title: 'Engine unreachable.',
          detail: lastError ?? 'Chat, tools and runs need the XR engine.',
        };
    }
  }
  return {
    title: 'Engine not running.',
    detail: `Chat, tools and runs need the XR engine.${lastError ? ` ${lastError}` : ''}`,
  };
}
