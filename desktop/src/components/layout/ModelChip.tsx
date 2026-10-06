/*
 * Topbar model chip (Phase 14 · cross-surface).
 *
 * Shows the model the next turn will use — the active chat session's model
 * on /chat/:id, the desktop default elsewhere — and opens the same live
 * ModelPicker the composer uses. The palette's "Switch model…" command
 * opens it too, via the `xr:open-model-picker` window event.
 */
import { Cpu } from 'lucide-react';
import { useLocation } from 'react-router-dom';

import { ModelPicker } from '@/screens/Chat/components/ModelPicker';
import { useEngineStore } from '@/stores/engineStore';

export const OPEN_MODEL_PICKER_EVENT = 'xr:open-model-picker';

export function ModelChip() {
  const { pathname } = useLocation();
  const engineUp = useEngineStore((s) => s.status === 'up');
  const sessionId = /^\/chat\/([^/]+)/.exec(pathname)?.[1] ?? null;

  return (
    <ModelPicker
      sessionId={sessionId}
      openOnEvent={OPEN_MODEL_PICKER_EVENT}
      side="bottom"
      align="end"
      trigger={(label) => (
        <button
          type="button"
          data-testid="topbar-model-chip"
          aria-label={`Model: ${label}. Switch model`}
          title={engineUp ? 'Switch model' : 'Engine not running — the model list comes from the engine'}
          className="border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-raised focus-visible:ring-accent hidden h-7 max-w-[180px] items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] transition-colors focus-visible:ring-2 focus-visible:outline-none md:flex"
        >
          <Cpu size={12} strokeWidth={1.75} aria-hidden="true" className={engineUp ? 'text-text-tertiary' : 'text-danger'} />
          <span className="truncate">{label}</span>
        </button>
      )}
    />
  );
}
