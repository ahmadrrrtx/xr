/*
 * Honest failure card for an assistant turn that produced nothing
 * (Phase 14). One shape per cause, each with the real repair path:
 *   no_provider  "No AI provider configured…"  → Add API key · Install Ollama
 *   engine_down  engine unreachable              → Retry · Start/Restart engine
 *   auth         session token rejected          → Restart engine
 *   busy         lane busy / rate-limited        → Retry (after a moment)
 *   interrupted  stream cut                      → Retry
 *   model        provider/model failure          → Retry when retryable
 * Never a fabricated reply; never "thinking" dots over a dead link.
 */
import { KeyRound, RefreshCw, ServerCrash, Unplug, Hourglass, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import type { TurnError } from '@/lib/chat-db';
import { openUrl } from '@/lib/settingsApi';
import { cn } from '@/lib/utils';
import { useEngineStore } from '@/stores/engineStore';

const OLLAMA_URL = 'https://ollama.com/download';

function openExternal(url: string): void {
  void openUrl(url).catch(() => window.open(url, '_blank', 'noopener,noreferrer'));
}

function copyFor(e: TurnError): { icon: typeof Unplug; title: string; detail: string | null; tone: 'warning' | 'danger' } {
  switch (e.kind) {
    case 'no_provider':
      return {
        icon: KeyRound,
        title: 'No AI provider configured.',
        detail: 'Add an API key or install Ollama to chat.',
        tone: 'warning',
      };
    case 'engine_down':
      return { icon: Unplug, title: 'Engine not running.', detail: 'Chat needs the XR engine. Start it and retry.', tone: 'warning' };
    case 'auth':
      return { icon: ServerCrash, title: 'Engine rejected the session token.', detail: 'Restart the engine to issue a new one.', tone: 'danger' };
    case 'busy':
      return { icon: Hourglass, title: 'The engine is busy.', detail: e.message || 'Another run holds the lane. Try again in a moment.', tone: 'warning' };
    case 'interrupted':
      return { icon: TriangleAlert, title: 'Interrupted — the stream ended before the reply finished.', detail: null, tone: 'danger' };
    case 'request':
      return { icon: TriangleAlert, title: 'The engine refused the request.', detail: e.message, tone: 'danger' };
    default:
      return {
        icon: TriangleAlert,
        title: e.code === 'turn.empty' ? 'The model returned nothing.' : 'The model run failed.',
        detail:
          e.code === 'turn.empty'
            ? 'Small local models sometimes emit an empty or malformed turn. Retry, or switch to a larger model.'
            : e.message,
        tone: 'danger',
      };
  }
}

export function TurnErrorCard({
  error,
  onRetry,
  compact = false,
  className,
}: {
  error: TurnError;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}) {
  const navigate = useNavigate();
  const restarting = useEngineStore((s) => s.restarting);
  const endpoint = useEngineStore((s) => s.endpoint);
  const [busyCooldown, setBusyCooldown] = useState(false);
  const c = copyFor(error);
  const Icon = c.icon;
  const tone = c.tone === 'danger' ? 'var(--danger)' : 'var(--warning)';
  const canStart = import.meta.env.DEV || endpoint?.via === 'sidecar';
  const showRetry = !!onRetry && error.kind !== 'no_provider' && error.kind !== 'auth' && (error.kind !== 'model' || error.retryable !== false);

  const retry = (): void => {
    if (error.kind === 'busy') {
      // Simple backoff: the lane needs a moment; don't hammer it.
      setBusyCooldown(true);
      window.setTimeout(() => {
        setBusyCooldown(false);
        onRetry?.();
      }, 1500);
      return;
    }
    onRetry?.();
  };

  const startEngine = async (): Promise<void> => {
    const r = await useEngineStore.getState().startOrRestart();
    toast(r.ok ? 'Engine is up' : 'Engine did not start', { description: r.message });
    if (r.ok) onRetry?.();
  };

  const btn = 'border-border-subtle bg-bg-raised text-text-primary hover:bg-bg-raised/70 h-7 cursor-pointer rounded-md border px-2.5 text-[12px] font-medium transition-colors disabled:opacity-60';
  const link = 'text-text-tertiary hover:text-text-primary h-7 cursor-pointer px-1 text-[12px] underline-offset-2 hover:underline';

  return (
    <div
      role="status"
      data-testid="chat-turn-error"
      data-kind={error.kind}
      className={cn(
        'border-border-subtle bg-bg-ink text-text-primary rounded-2xl rounded-tl-[4px] border px-4 py-3',
        compact && 'rounded-lg px-3 py-2',
        className,
      )}
      style={{ borderLeft: `3px solid ${tone}` }}
    >
      <div className="flex items-start gap-2.5">
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: tone }} />
        <div className="min-w-0 flex-1">
          <p className={cn('font-semibold', compact ? 'text-[12px]' : 'text-[13px]')}>{c.title}</p>
          {c.detail && (
            <p className={cn('text-text-secondary mt-0.5 leading-relaxed break-words', compact ? 'text-[11px]' : 'text-[12px]')}>
              {c.detail}
            </p>
          )}
          {error.kind === 'model' && error.code && (
            <p className="text-text-tertiary mt-1 font-mono text-[10.5px]">{error.code}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {error.kind === 'no_provider' && (
              <>
                <button type="button" onClick={() => navigate('/budget?tab=models')} className={btn}>
                  Add API key
                </button>
                <button type="button" onClick={() => openExternal(OLLAMA_URL)} className={link}>
                  Install Ollama
                </button>
              </>
            )}
            {(error.kind === 'engine_down' || error.kind === 'auth') && canStart && (
              <button type="button" onClick={() => void startEngine()} disabled={restarting} className={btn}>
                <span className="flex items-center gap-1.5">
                  <RefreshCw size={12} strokeWidth={1.75} aria-hidden="true" className={restarting ? 'animate-spin' : ''} />
                  {endpoint?.via === 'sidecar' || error.kind === 'auth' ? 'Restart engine' : 'Start engine'}
                </span>
              </button>
            )}
            {showRetry && (
              <button
                type="button"
                onClick={retry}
                disabled={busyCooldown}
                className={error.kind === 'engine_down' || error.kind === 'no_provider' ? link : btn}
              >
                {busyCooldown ? 'Retrying…' : 'Retry'}
              </button>
            )}
            {error.kind !== 'no_provider' && (
              <button type="button" onClick={() => navigate('/settings#diagnostics')} className={link}>
                Diagnostics
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
