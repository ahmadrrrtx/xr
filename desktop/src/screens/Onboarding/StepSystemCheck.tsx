import { useEffect, useState } from 'react';

import { detectGpu, detectMics, detectOllama, detectSystem } from '@/lib/detect';
import { useOnboardingStore } from '@/stores/onboarding';
import { CheckRow } from './parts';

type RowState = 'checking' | 'ok' | 'warn';

/**
 * Step 3 — real system check (not skippable). Rows resolve staggered; all
 * done → Continue (warnings allowed — they're informational, not blockers).
 */
export function StepSystemCheck() {
  const { systemInfo, gpu, mics, ollama, setDetections } = useOnboardingStore();
  const [rows, setRows] = useState<Record<string, RowState>>({
    os: 'checking',
    cpu: 'checking',
    memory: 'checking',
    gpu: 'checking',
    mic: 'checking',
    ollama: 'checking',
  });
  const [micDenied, setMicDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const set = (k: string, s: RowState) =>
      !cancelled && setRows((r) => ({ ...r, [k]: s }));

    (async () => {
      // Kick everything off in parallel; render staggered as results land.
      const sys = detectSystem().then((s) => {
        if (cancelled) return s;
        setDetections({ systemInfo: s });
        set('os', 'ok');
        set('cpu', 'ok');
        set('memory', 'ok');
        return s;
      });

      const gpuP = detectGpu().then((g) => {
        if (cancelled) return g;
        setDetections({ gpu: g });
        set('gpu', g.software ? 'warn' : 'ok');
        return g;
      });

      const micP = detectMics(false).then((m) => {
        if (cancelled) return m;
        setDetections({ mics: m });
        setMicDenied(m.permission === 'denied');
        set('mic', m.devices.length > 0 ? 'ok' : m.permission === 'denied' ? 'warn' : 'ok');
        return m;
      });

      const ollamaP = detectOllama().then((o) => {
        if (cancelled) return o;
        setDetections({ ollama: o });
        set('ollama', o.installed ? 'ok' : 'warn');
        return o;
      });

      const [sysV, gpuV, micV, ollamaV] = await Promise.all([sys, gpuP, micP, ollamaP]);
      if (!cancelled) setDetections({ checking: false, systemInfo: sysV, gpu: gpuV, mics: micV, ollama: ollamaV });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const mem = systemInfo?.totalMemoryGb;
  const ramRow = systemInfo
    ? `${systemInfo.totalMemoryGb} GB${mem !== undefined && mem < 8 ? ' — small models only' : ''}`
    : null;

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
          hint={systemInfo && systemInfo.totalMemoryGb < 8 ? 'Under 8 GB — XR will prefer the smallest models.' : undefined}
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
          hint={ollama && !ollama.installed ? 'You can install Ollama in the next steps — or bring your own key.' : undefined}
        />
      </div>

      {ollama && ollama.installed && ollama.models.length > 0 && (
        <p className="text-text-tertiary mt-3 text-[12.5px]">
          Models found: {ollama.models.map((m) => m.name).join(', ')}
        </p>
      )}
    </div>
  );
}
