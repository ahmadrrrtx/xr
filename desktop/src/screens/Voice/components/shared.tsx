/*
 * Shared voice visuals (Phase 15): the canvas waveform, the state chip, the
 * cost chip, the model download card and the microphone permission card.
 * Colour never carries meaning alone — every state also has an icon/label.
 */
import { useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  Check,
  Download,
  Ear,
  Loader2,
  Mic,
  MicOff,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Volume2,
  WifiOff,
  X,
} from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/tauri';
import { formatBytes } from '@/voice/audio';
import { openMicrophoneSettings } from '@/voice/platform';
import { STATE_COPY, voice } from '@/voice/session';
import type { VoiceSessionState } from '@/voice/voiceApi';
import { useVoiceStore } from '@/voice/voiceStore';

/* ── waveform ───────────────────────────────────────────────────────────── */

export function Waveform({
  className,
  bars = 48,
  color,
  height = 56,
  idleLevel = 0.06,
}: {
  className?: string;
  bars?: number;
  /** CSS colour; defaults to the theme accent. */
  color?: string;
  height?: number;
  idleLevel?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = useReducedMotion();
  const active = useVoiceStore((s) => s.active);
  const state = useVoiceStore((s) => s.sessionState);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const samples = new Float32Array(new ArrayBuffer(bars * 4 * 4));
    const smooth = new Float32Array(bars);
    let raf = 0;
    let alive = true;
    const paint = (): void => {
      if (!alive) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const live = active && voice.waveform(samples);
      const stroke = color ?? (getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#00E5FF');
      const gap = 2;
      const bw = Math.max(1, (w - gap * (bars - 1)) / bars);
      const speaking = state === 'speaking';
      for (let i = 0; i < bars; i++) {
        let v = idleLevel;
        if (live) {
          let peak = 0;
          for (let j = 0; j < 4; j++) peak = Math.max(peak, Math.abs(samples[i * 4 + j] ?? 0));
          v = Math.min(1, peak * (speaking ? 1.6 : 3.2));
        } else if (active && !reduceMotion) {
          v = idleLevel + 0.03 * Math.sin(performance.now() / 500 + i / 3);
        }
        smooth[i] = reduceMotion ? v : (smooth[i] ?? 0) * 0.6 + v * 0.4;
        const bh = Math.max(2, (smooth[i] ?? 0) * h);
        ctx.globalAlpha = live || speaking ? 0.95 : 0.45;
        ctx.fillStyle = stroke;
        const x = i * (bw + gap);
        const y = (h - bh) / 2;
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, bw / 2);
        ctx.fill();
      }
      if (reduceMotion && !live) return; // one static frame is enough
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [active, bars, color, idleLevel, reduceMotion, state]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={active ? `Audio level — ${STATE_COPY[state].toLowerCase()}` : 'Audio level — idle'}
      className={cn('block w-full', className)}
      style={{ height }}
    />
  );
}

/* ── state chip ─────────────────────────────────────────────────────────── */

const STATE_TONE: Record<VoiceSessionState, { icon: typeof Mic; tone: string }> = {
  idle: { icon: Mic, tone: 'text-text-secondary border-border-default' },
  listening: { icon: Ear, tone: 'text-accent border-accent/50' },
  thinking: { icon: Loader2, tone: 'text-text-primary border-border-default' },
  planning: { icon: Loader2, tone: 'text-text-primary border-border-default' },
  working: { icon: Loader2, tone: 'text-text-primary border-border-default' },
  tool: { icon: Sparkles, tone: 'text-text-primary border-border-default' },
  approval: { icon: ShieldAlert, tone: 'text-warning border-warning/60' },
  speaking: { icon: Volume2, tone: 'text-accent border-accent/50' },
  success: { icon: Check, tone: 'text-success border-success/50' },
  interrupted: { icon: Ear, tone: 'text-accent border-accent/50' },
  error: { icon: AlertTriangle, tone: 'text-danger border-danger/50' },
  offline: { icon: WifiOff, tone: 'text-text-tertiary border-border-default' },
};

export function StateChip({ state, className, dark }: { state: VoiceSessionState; className?: string; dark?: boolean }) {
  const { icon: Icon, tone } = STATE_TONE[state];
  const spin = state === 'thinking' || state === 'planning' || state === 'working';
  return (
    <span
      data-testid="voice-state-chip"
      data-state={state}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium',
        dark ? 'bg-white/5' : 'bg-bg-ink',
        tone,
        className,
      )}
    >
      <Icon size={13} strokeWidth={1.75} aria-hidden="true" className={cn(spin && 'motion-safe:animate-spin')} />
      <span aria-live="polite">{STATE_COPY[state]}</span>
    </span>
  );
}

/* ── cost chip ──────────────────────────────────────────────────────────── */

export function CostChip({ className, dark }: { className?: string; dark?: boolean }) {
  const cost = useVoiceStore((s) => s.cost);
  if (!cost.cloud) {
    return (
      <span
        className={cn(
          'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px]',
          dark ? 'border-white/15 text-white/55' : 'border-border-subtle text-text-tertiary',
          className,
        )}
        title="Speech runs on this machine — no per-minute cost."
      >
        local · free
      </span>
    );
  }
  return (
    <Link
      to="/budget"
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] hover:underline',
        dark ? 'border-white/20 text-white/80' : 'border-border-default text-text-secondary',
        className,
      )}
      title="Cloud speech is metered. Opens Budget."
    >
      ≈${cost.perHourUsd.toFixed(2)}/hr
      {cost.sessionUsd > 0 ? <span className="opacity-70">· ${cost.sessionUsd.toFixed(3)} so far</span> : null}
    </Link>
  );
}

/* ── download card ──────────────────────────────────────────────────────── */

export function ModelDownloadCard({ className, compact }: { className?: string; compact?: boolean }) {
  const status = useVoiceStore((s) => s.status);
  const download = useVoiceStore((s) => s.download);
  const busy = useVoiceStore((s) => s.downloadBusy);
  const err = useVoiceStore((s) => s.downloadError);
  const startDownload = useVoiceStore((s) => s.startDownload);
  const cancelDownload = useVoiceStore((s) => s.cancelDownload);
  const applySettings = useVoiceStore((s) => s.applySettings);
  const statusError = useVoiceStore((s) => s.statusError);

  if (statusError === 'engine-down') {
    return (
      <Card className={className} tone="warn" icon={WifiOff} title="Engine offline">
        <p>Voice needs the XR engine running. It will reconnect on its own.</p>
      </Card>
    );
  }
  if (!status) return null;
  const pending = status.firstRun.pending;
  if (pending.length === 0 && !busy) return null;

  const total = download?.bundleTotal ?? status.firstRun.bytes;
  const received = download?.bundleReceived ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
  const running = busy && download && (download.status === 'downloading' || download.status === 'extracting');
  const failed = download?.status === 'error' || download?.status === 'cancelled' || !!err;

  return (
    <Card
      className={className}
      tone="info"
      icon={Download}
      title={running ? 'Downloading voice models' : 'Voice models need to be downloaded'}
      testId="voice-download-card"
    >
      {!running ? (
        <p>
          About <strong className="text-text-primary">{formatBytes(status.firstRun.bytes)}</strong> once, kept on this machine, so speech recognition and
          the voice work offline. {pending.map((p) => p.name).join(' · ')}.
        </p>
      ) : (
        <div className="space-y-1.5">
          <div className="text-text-secondary flex items-center justify-between text-[12px]">
            <span className="truncate">
              {download.status === 'extracting' ? 'Unpacking' : 'Downloading'} {download.file ?? download.id}
            </span>
            <span className="tabular-nums">
              {pct}% · {formatBytes(received)} / {formatBytes(total)}
            </span>
          </div>
          <div className="bg-bg-raised h-1.5 w-full overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Voice model download">
            <div className="bg-accent h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {failed && !running ? (
        <p className="text-warning mt-1.5 flex items-center gap-1 text-[12px]">
          <AlertTriangle size={12} aria-hidden="true" />
          {err ?? (download?.status === 'cancelled' ? 'Cancelled — partial files are kept, retry resumes.' : 'Download failed. Check the connection and retry.')}
        </p>
      ) : null}
      <div className={cn('mt-3 flex flex-wrap items-center gap-2', compact && 'mt-2')}>
        {running ? (
          <Button size="sm" variant="secondary" onClick={() => void cancelDownload()} data-testid="voice-download-cancel">
            <X size={14} aria-hidden="true" /> Cancel
          </Button>
        ) : (
          <Button size="sm" onClick={() => void startDownload({ firstRun: true })} data-testid="voice-download-start">
            {failed ? <RefreshCw size={14} aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
            {failed ? 'Retry' : `Download ${formatBytes(status.firstRun.bytes)}`}
          </Button>
        )}
        {!running ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void applySettings({ sttBackend: 'groq', ttsBackend: 'openai' });
            }}
            title="Sends audio to Groq (speech to text) and OpenAI (voice). Metered, needs network and provider keys."
          >
            Use cloud voice instead
          </Button>
        ) : null}
      </div>
      {!running ? (
        <p className="text-text-tertiary mt-2 text-[11px]">
          Cloud voice sends your audio to a provider, needs network and keys, and is metered (shown as ≈$/hr).
        </p>
      ) : null}
    </Card>
  );
}

/* ── permission / no-mic card ───────────────────────────────────────────── */

export function PermissionCard({ className, onRetry }: { className?: string; onRetry: () => void }) {
  const permission = useVoiceStore((s) => s.micPermission);
  if (permission === 'denied') {
    return (
      <Card className={className} tone="warn" icon={MicOff} title="Microphone access is off" testId="voice-permission-card">
        <p>XR cannot hear you until the system allows it. Nothing is recorded without this permission.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void openMicrophoneSettings()} disabled={!isTauri()}>
            Open system settings
          </Button>
        </div>
      </Card>
    );
  }
  if (permission === 'no-device') {
    return (
      <Card className={className} tone="warn" icon={MicOff} title="No microphone detected" testId="voice-nomic-card">
        <p>Plug one in or pick another input — the list refreshes on its own.</p>
        <div className="mt-3">
          <Button size="sm" variant="secondary" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" /> Refresh devices
          </Button>
        </div>
      </Card>
    );
  }
  if (permission === 'unsupported') {
    return (
      <Card className={className} tone="warn" icon={MicOff} title="No microphone access here">
        <p>This environment does not expose audio capture.</p>
      </Card>
    );
  }
  return null;
}

/* ── card primitive ─────────────────────────────────────────────────────── */

export function Card({
  title,
  icon: Icon,
  tone = 'info',
  className,
  children,
  testId,
}: {
  title: string;
  icon: typeof Mic;
  tone?: 'info' | 'warn' | 'danger';
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      role={tone === 'info' ? undefined : 'status'}
      className={cn(
        'border-border-subtle bg-bg-ink rounded-xl border p-4',
        tone === 'warn' && 'border-warning/40',
        tone === 'danger' && 'border-danger/40',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
            tone === 'info' && 'bg-accent/10 text-accent',
            tone === 'warn' && 'bg-warning/10 text-warning',
            tone === 'danger' && 'bg-danger/10 text-danger',
          )}
        >
          <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="text-text-secondary min-w-0 flex-1 text-[13px] leading-relaxed">
          <h3 className="text-text-primary mb-1 text-[14px] font-medium">{title}</h3>
          {children}
        </div>
      </div>
    </div>
  );
}
