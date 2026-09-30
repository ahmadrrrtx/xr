/*
 * Model picker popover (Phase 4) — static catalogue for now (real model
 * management is Settings/Phase 8+). Selecting sets the session's model and
 * persists it as the default (xr.model.default, seeded by onboarding).
 */
import { Check, Cpu, Sparkles, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { chatDb } from '@/lib/chat-db';
import { DEFAULT_MODEL, useSessionsStore } from '@/stores/sessionsStore';
import { writeSettingJSON } from '@/lib/persistent-store';

export const MODELS = [
  {
    id: 'claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    desc: 'Best for coding & agents',
    badge: 'cloud',
    icon: Sparkles,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o-mini',
    desc: 'Fast + cheap everyday model',
    badge: 'cloud',
    icon: Zap,
  },
  {
    id: 'qwen2.5:3b',
    name: 'Qwen 2.5 3B',
    desc: 'Local via Ollama — private',
    badge: 'local',
    icon: Cpu,
  },
] as const;

export function ModelPicker({ sessionId }: { sessionId: string | null }) {
  const navigate = useNavigate();
  const sessions = useSessionsStore();
  const active =
    sessions.sessions.find((s) => s.id === sessionId)?.model ?? DEFAULT_MODEL;

  const activeModel = MODELS.find((m) => m.id === active);
  const label = activeModel?.name ?? 'Claude Sonnet 4.5';

  const pick = async (id: string) => {
    if (!sessionId) {
      await writeSettingJSON('xr.model.default', id);
      // Reflect in any future session creation.
      useSessionsStore.setState((st) => ({
        sessions: st.sessions.map((s) => (s.id === st.activeSessionId ? { ...s, model: id } : s)),
      }));
      return;
    }
    await chatDb.updateSessionModel(sessionId, id);
    useSessionsStore.setState((st) => ({
      sessions: st.sessions.map((s) => (s.id === sessionId ? { ...s, model: id } : s)),
    }));
    await writeSettingJSON('xr.model.default', id);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-text-tertiary hover:bg-bg-raised hover:text-text-secondary rounded px-2 py-0.5 text-[12px] font-medium transition-colors focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none"
          aria-label={`Model: ${label}. Change model`}
        >
          {label} ▾
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-70 border-border-subtle bg-bg-ink p-1">
        <div className="text-text-tertiary px-2 py-1.5 text-[11px] font-semibold tracking-wide uppercase">
          Model
        </div>
        {MODELS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => void pick(m.id)}
            role="menuitemradio"
            aria-checked={m.id === active}
            className="hover:bg-bg-raised flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left"
          >
            <m.icon
              aria-hidden="true"
              className="text-text-secondary mt-0.5 size-4 shrink-0"
              strokeWidth={1.5}
            />
            <span className="min-w-0 flex-1">
              <span className="text-text-primary block text-[13px] font-semibold">
                {m.name}
              </span>
              <span className="text-text-tertiary block text-[11px]">{m.desc}</span>
            </span>
            <span className="text-text-tertiary font-mono text-[9px] tracking-wide uppercase">
              {m.badge}
            </span>
            {m.id === active && (
              <Check aria-hidden="true" className="text-accent mt-0.5 size-4" strokeWidth={1.5} />
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => navigate('/settings')}
          className="text-text-tertiary hover:text-text-secondary mt-1 w-full border-t border-border-subtle px-2 pt-2 pb-1 text-left text-[12px]"
        >
          Manage models →
        </button>
      </PopoverContent>
    </Popover>
  );
}
