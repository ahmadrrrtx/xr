import { useEffect, useState } from 'react';

import {
  DetectionUnavailable,
  detectGpu,
  detectMics,
  detectOllama,
  detectSystem,
  probeDetection,
} from '@/lib/detect';
import { useOnboardingStore } from '@/stores/onboarding';
import { CheckRow } from './parts';

type RowState = 'checking' | 'ok' | 'warn' | 'unknown';

/**
 * Step 3 — real system check (not skippable). Rows resolve staggered; all
 * done → Continue (warnings allowed — they're informational, not blockers).
 *
 * XR-REL-01: a detection that cannot run is `unknown` and SAYS so. This step
 * used to display a hardcoded laptop profile whenever the shell denied the IPC
 * call, and step 4 then recommended a 4.7 GB download from it.
 */
export function StepSystemCheck() {
  const {
    systemInfo,
    gpu,
    mics,
    ollama,
    setDetections,
    detectFailures,
  } = useOnboardingStore();
  const [rows, setRows] = useState<Record<string, RowState>>({
    os: 'checking',
    cpu: 'checking',
    memory: 'checking',
    gpu: 'checking',
    mic: 'checking',
    ollama: 'checking',
  });
  const [micDenied, setMicDenied] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const set = (k: string, s: RowState) =>
      !cancelled && setRows((r) => ({ ...r, [k]: s }));

    setRows({
      os: 'checking',
      cpu: 'checking',
      memory: 'checking',
      gpu: 'checking',
      mic: 'checking',
      ollama: 'checking',
    });

    (async () => {
      // Kick everything off in parallel; render staggered as results land.
      const sysP = probeDetection('system', detectSystem).then((r) => {
        if (cancelled) return r;
        if (r.value) {
          setDetections({ systemInfo: r.value, detectFailures: {} });
          set('os', 'ok');
          set('cpu', 'ok');
          set('memory', 'ok');
        } else {
          // One probe feeds three rows — all three are unknown, with a reason.
          setDetections({
            systemInfo: null,
            detectFailures: { ...detectFailures, system: r.failure },
          });
          set('os', 'unknown');
          set('cpu', 'unknown');
          set('memory', 'unknown');
        }
        return r;
      });

      const gpuP = probeDetection('gpu', detectGpu).then((r) => {
        if (cancelled) return r;
        if (r.value) {
          setDetections({ gpu: r.value });
          set('gpu', r.value.software ? 'warn' : 'ok');
        } else {
          setDetections({ gpu: null });
          set('gpu', 'unknown');
        }
        return r;
      });

      // Mic uses webview APIs only — never fabricates a device list.
      const micP = detectMics(false)
        .then((m) => {
          if (cancelled) return m;
          setDetections({ mics: m });
          setMicDenied(m.permission === 'denied');
          set(
            'mic',
            m.devices.length > 0
              ? 'ok'
              : m.permission === 'denied'
                ? 'warn'
                : 'ok'
          );
          return m;
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setDetections({ mics: null });
            set('mic', 'unknown');
          }
          console.warn('[xr] mic probe failed', error);
          return null;
        });

      const ollamaP = probeDetection('ollama', detectOllama).then((r) => {
        if (cancelled) return r;
        if (r.value) {
          setDetections({ ollama: r.value });
          set('ollama', r.value.installed ? 'ok' : 'warn');
        } else {
          setDetections({
            ollama: null,
            detectFailures: { ...detectFailures, ollama: r.failure },
          });
          set('ollama', 'unknown');
        }
        return r;
      });

      await Promise.all([sysP, gpuP, micP, ollamaP]);
      if (!cancelled) setDetections({ checking: false });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run on mount + explicit retry
  }, [attempt]);

  const systemFailure = detectFailures.system ?? null;
  const ollamaFailure = detectFailures.ollama ?? null;
  const mem = systemInfo?.totalMemoryGb;
  const ramRow = systemInfo
    ? `${systemInfo.totalMemoryGb} GB${mem !== undefined && mem < 8 ? ' — small models only' : ''}`
    : null;
  const hardwareUnknown = rows.memory === 'unknown';

  return (
    <div>
      <header className="mb-5">
        <h2 className="text-text-primary text-[22px] font-semibold">Checking your system.</h2>
        <p className="text-text-tertiary mt-1.5 text-[13.5px]">
          Real checks — a few seconds. Warnings never block you.
        </p>
      </header>

      <div className="border-border-subtle rounded-xl border px-4">
        <CheckRow
          label="Operating system"
          value={systemInfo ? `${systemInfo.os}${systemInfo.osVersion ? ` ${systemInfo.osVersion}` : ''}` : null}
          state={rows.os}
          hint={systemFailure ?? undefined}
        />
        <CheckRow
          label="Processor"
          value={systemInfo ? `${systemInfo.cpuBrand} · ${systemInfo.cpuCores} cores` : null}
          state={rows.cpu}
        />
        <CheckRow
          label="Memory"
          value={systemInfo ? ramRow : null}
          state={rows.memory}
          hint={
            systemInfo && systemInfo.totalMemoryGb < 8
              ? 'Under 8 GB — XR will prefer the smallest models.'
              : (systemFailure ?? undefined)
          }
        />
        <CheckRow
          label="Graphics"
          value={gpu?.name ?? (rows.gpu === 'checking' ? null : 'Not detected')}
          state={rows.gpu}
          hint={gpu?.software ? 'Software rendering — XR will avoid GPU-heavy effects.' : undefined}
        />
        <CheckRow
          label="Microphone"
          value={
            mics
              ? micDenied
                ? 'Permission denied'
                : mics.devices.length > 0
                  ? (mics.devices[0]?.label ?? `${mics.devices.length} available`)
                  : 'None found'
              : null
          }
          state={rows.mic}
          hint={micDenied ? 'You can grant mic access later in system settings.' : undefined}
        />
        <CheckRow
          label="Ollama"
          value={
            ollama
              ? ollama.installed
                ? `Installed${ollama.version ? ` · ${ollama.version}` : ''}`
                : 'Not found'
              : null
          }
          state={rows.ollama}
          hint={
            ollama && !ollama.installed
              ? 'You can install Ollama in the next steps — or bring your own key.'
              : (ollamaFailure ?? undefined)
          }
        />
      </div>

      {hardwareUnknown && (
        <div className="border-warning/40 bg-warning/5 mt-4 rounded-xl border p-3.5">
          <p className="text-warning text-[12.5px] font-medium">
            This machine&apos;s hardware could not be read.
          </p>
          <p className="text-text-tertiary mt-1 text-[12px] leading-relaxed">
            {systemFailure ??
              'The local engine did not answer the detection request.'}{' '}
            XR will not guess a model size for unknown hardware — you can still
            continue and pick a model yourself, or retry.
          </p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="text-accent hover:text-accent-hover mt-2 text-[12.5px] font-medium"
          >
            Retry detection
          </button>
        </div>
      )}

      {ollama && ollama.installed && ollama.models.length > 0 && (
        <p className="text-text-tertiary mt-3 text-[12.5px]">
          Models found: {ollama.models.map((m) => m.name).join(', ')}
        </p>
      )}

      {ollamaFailure && !hardwareUnknown && (
        <p className="text-text-tertiary mt-3 text-[12.5px]">{ollamaFailure}</p>
      )}
    </div>
  );
}

/** Re-exported for callers that need the typed error (tests, diagnostics). */
export { DetectionUnavailable };
