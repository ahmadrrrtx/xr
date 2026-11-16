import { ExternalLink, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { openExternal, startModelPull, type PullHandle } from '@/lib/detect';
import { useOnboardingStore } from '@/stores/onboarding';
import { Reveal, StepHeader } from './parts';

const OLLAMA_URL = 'https://ollama.com/download';

/**
 * Step 5 — model download.
 *
 * XR-REL-02: this step used to fabricate its own progress (a timer over a
 * made-up byte total) and describe it as "real bytes, real progress". It now
 * streams the ENGINE's pull (`POST /models/pull`), so every number rendered
 * here — completed, total, percentage — came from the local runtime.
 *
 * When there is nothing honest to show, the step says so:
 *   · no engine  → "needs the local engine", no fake progress;
 *   · no runtime → the install card (unchanged);
 *   · a runtime that reports layers without byte counts → the runtime's own
 *     status line and an indeterminate bar, never an invented percentage.
 */
export function StepDownload() {
  const { modelChoice, ollama, download, setDownload } = useOnboardingStore();
  const handle = useRef<PullHandle | null>(null);
  const [retries, setRetries] = useState(0);

  const model = modelChoice.source === 'local' ? modelChoice.model : null;
  const label = modelChoice.source === 'local' ? modelChoice.label : null;

  const start = useCallback(
    async (m: string) => {
      handle.current?.cancel();
      setDownload({ status: 'downloading', pct: 0, completedGb: 0, totalGb: 0 });
      try {
        const pull = await startModelPull(m, (e) => {
          if (e.status === 'success') {
            setDownload({ status: 'done' });
            return;
          }
          if (e.status === 'error') {
            setDownload({ status: 'error', message: e.detail ?? 'The pull failed.' });
            return;
          }
          // No total from the runtime → an indeterminate bar, not a guess.
          setDownload({
            status: 'downloading',
            pct: e.pct !== undefined ? Math.min(100, e.pct * 100) : Number.NaN,
            completedGb: e.completed !== undefined ? e.completed / 1e9 : 0,
            totalGb: e.total !== undefined ? e.total / 1e9 : 0,
          });
        });
        handle.current = pull;
        await pull.done;
      } catch (error) {
        setDownload({
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'The engine could not start the download.',
        });
      }
    },
    [setDownload]
  );

  useEffect(() => {
    if (model && ollama?.installed && download.status === 'idle') {
      void start(model);
    }
    return () => handle.current?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start when model/ollama ready
  }, [model, ollama?.installed]);

  // Guest / cloud — nothing to download.
  if (!model) {
    return (
      <div>
        <StepHeader title="Nothing to download." sub="You chose guest or cloud mode — XR is ready as-is." />
        <Reveal>
          <p className="text-text-tertiary text-[13.5px]">
            You can switch to a local model anytime from Settings → Models.
          </p>
        </Reveal>
      </div>
    );
  }

  // Ollama missing → install card.
  if (ollama && !ollama.installed) {
    return (
      <div>
        <StepHeader
          title="One thing first — Ollama."
          sub="XR runs local models through Ollama. Install it, then come back."
        />
        <Reveal>
          <div className="border-border-subtle bg-bg-raised/40 rounded-xl border p-5 text-center">
            <p className="text-text-primary text-[14px] font-medium">Ollama isn't installed yet</p>
            <p className="text-text-tertiary mx-auto mt-1 max-w-[40ch] text-[12.5px] leading-relaxed">
              Free and open-source. Takes about a minute, then we'll download {label ?? 'the model'} here.
            </p>
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => void openExternal(OLLAMA_URL)}
                className="bg-accent text-accent-contrast hover:bg-accent-hover inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold"
              >
                <ExternalLink aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
                Get Ollama
              </button>
              <button
                type="button"
                onClick={() => setRetries((r) => r + 1)}
                className="text-text-secondary hover:text-text-primary inline-flex items-center gap-2 rounded-lg border border-border-subtle px-4 py-2 text-[13px] font-medium"
              >
                <RotateCcw aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
                I've installed it — recheck
              </button>
            </div>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="text-text-tertiary mt-4 text-center text-[12px]">
            Or press Skip — XR works in guest mode meanwhile.
          </p>
        </Reveal>
        <RecheckTrigger retries={retries} />
      </div>
    );
  }

  // Ollama state UNKNOWN (the probe could not run) — never show a fake 0%.
  if (ollama === null) {
    return (
      <div>
        <StepHeader
          title="Can't reach Ollama yet."
          sub="XR downloads local models through Ollama, and the local engine did not confirm it is running."
        />
        <Reveal>
          <div className="border-border-subtle bg-bg-raised/40 rounded-xl border p-5">
            <p className="text-text-tertiary text-[12.5px] leading-relaxed">
              Nothing will be downloaded until Ollama answers. Start it (or start
              the local engine), then recheck — or press Skip and pick a model
              later from Settings → Models.
            </p>
            <button
              type="button"
              onClick={() => setRetries((r) => r + 1)}
              className="text-accent hover:text-accent-hover mt-3 inline-flex items-center gap-2 text-[13px] font-medium"
            >
              <RotateCcw aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
              Recheck Ollama
            </button>
          </div>
        </Reveal>
        <RecheckTrigger retries={retries} />
      </div>
    );
  }

  const indeterminate =
    download.status === 'downloading' && !Number.isFinite(download.pct);

  // Downloading / done / error.
  return (
    <div>
      <StepHeader
        title={`Downloading ${label ?? model}.`}
        sub="Through the local engine — the progress below is the runtime's own byte count."
      />
      <div className="border-border-subtle bg-bg-raised/40 rounded-xl border p-5">
        {download.status === 'done' ? (
          <p className="text-accent text-[14px] font-medium">✓ {label} ready — {model} installed.</p>
        ) : download.status === 'error' ? (
          <div>
            <p className="text-danger mb-1 text-[14px] font-medium">Download failed.</p>
            <p className="text-text-tertiary mb-3 font-mono text-[11.5px]">{download.message}</p>
            <button
              type="button"
              onClick={() => void start(model)}
              className="text-accent hover:text-accent-hover inline-flex items-center gap-2 text-[13px] font-medium"
            >
              <RotateCcw aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
              Retry
            </button>
          </div>
        ) : (
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-text-primary font-mono text-[13px]">{model}</span>
              <span className="text-text-tertiary font-mono text-[12px]" aria-live="polite">
                {download.status === 'downloading'
                  ? download.totalGb > 0
                    ? `${download.completedGb.toFixed(1)} / ${download.totalGb.toFixed(1)} GB`
                    : 'waiting for the runtime…'
                  : 'starting…'}
              </span>
            </div>
            <div
              className="bg-bg-void h-2 overflow-hidden rounded-full"
              role="progressbar"
              aria-label="Model download progress"
              aria-valuenow={
                download.status === 'downloading' && !indeterminate
                  ? Math.round(download.pct)
                  : undefined
              }
              aria-valuemin={0}
              aria-valuemax={100}
            >
              {indeterminate ? (
                <div className="bg-accent/60 h-full w-1/3 animate-pulse rounded-full" />
              ) : (
                <div
                  className="bg-accent h-full rounded-full transition-[width] duration-300"
                  style={{ width: `${download.status === 'downloading' ? download.pct : 0}%` }}
                />
              )}
            </div>
            <p className="text-text-tertiary mt-2 text-[11.5px]">
              {indeterminate
                ? 'The runtime is pulling layers but has not reported a total yet.'
                : `${Math.round(download.status === 'downloading' ? download.pct : 0)}% — you can keep exploring the wizard.`}
            </p>
          </div>
        )}
      </div>
      {download.status === 'error' && (
        <p className="text-text-tertiary mt-3 text-[12px]">
          Skip is fine — XR falls back to guest mode until a model lands.
        </p>
      )}
    </div>
  );
}

/** Fires a fresh detect_ollama when the user clicks recheck. */
function RecheckTrigger({ retries }: { retries: number }) {
  const setDetections = useOnboardingStore((s) => s.setDetections);
  useEffect(() => {
    if (retries === 0) return;
    void (async () => {
      const { detectOllama, probeDetection } = await import('@/lib/detect');
      const r = await probeDetection('ollama', detectOllama);
      setDetections(
        r.value
          ? { ollama: r.value }
          : {
              ollama: null,
              detectFailures: {
                ...useOnboardingStore.getState().detectFailures,
                ollama: r.failure,
              },
            }
      );
    })();
  }, [retries, setDetections]);
  return null;
}
