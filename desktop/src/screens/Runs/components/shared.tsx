/*
 * Control Room — small shared pieces (Phase 11): status icon, agent chip,
 * model mono chip. (Number tween lives in ../useTween.ts.)
 */
import { Check, Loader2, Pause, Square, X } from 'lucide-react';

import {
  RUN_STATUS_LABEL,
  type AgentKind,
  type RunStatus,
} from '@/brain/types';
import { cn } from '@/lib/utils';
import { agentColorVar } from '@/runs/core';

const STATUS_COLOR: Record<RunStatus, string> = {
  running: 'var(--accent)',
  completed: 'var(--success)',
  failed: 'var(--danger)',
  waiting: 'var(--warning)',
  killed: 'var(--text-tertiary)',
};

/** 14px status glyph; running spins + pulses, others are static. */
export function StatusIcon({
  status,
  className,
}: {
  status: RunStatus;
  className?: string;
}) {
  const common = {
    size: 14,
    strokeWidth: 1.75,
    'aria-hidden': true as const,
    style: { color: STATUS_COLOR[status] },
  };
  const label = RUN_STATUS_LABEL[status];
  return (
    <span
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center',
        className
      )}
      role="img"
      aria-label={label}
      title={label}
    >
      {status === 'running' && (
        <Loader2
          {...common}
          className="run-status-running animate-spin [animation-duration:1.4s]"
        />
      )}
      {status === 'completed' && <Check {...common} />}
      {status === 'failed' && <X {...common} />}
      {status === 'waiting' && <Pause {...common} fill="currentColor" />}
      {status === 'killed' && (
        <Square {...common} fill="currentColor" size={10} />
      )}
    </span>
  );
}

export function AgentChip({
  agent,
  kind,
  className,
}: {
  agent: string;
  kind: AgentKind;
  className?: string;
}) {
  const color = agentColorVar(agent, kind);
  return (
    <span
      className={cn(
        'inline-flex h-5 max-w-full items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap',
        className
      )}
      style={{
        color: `color-mix(in oklab, ${color} 80%, var(--text-primary))`,
        borderColor: `color-mix(in oklab, ${color} 40%, transparent)`,
        background: `color-mix(in oklab, ${color} 12%, transparent)`,
      }}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <span className="truncate">{agent}</span>
    </span>
  );
}

/** Mono model name; local models get the "local" tint. */
export function ModelCell({ model, local }: { model: string; local: boolean }) {
  return (
    <span
      className={cn(
        'truncate font-mono text-[12px]',
        local ? 'text-text-secondary' : 'text-text-secondary'
      )}
      title={local ? `${model} · local (no cost)` : model}
    >
      {model}
    </span>
  );
}
