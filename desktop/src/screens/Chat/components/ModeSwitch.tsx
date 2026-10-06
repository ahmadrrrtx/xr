/*
 * Ask / Agent / Plan segmented control (Phase 14). Maps 1:1 onto the
 * engine's execution modes: `ask` is read-only (no tools), `agent` runs
 * tools behind approvals, `plan` drafts steps without acting. Per-session,
 * default agent; the last choice becomes the default for new chats.
 */
import { useChatStore, modeFor, CHAT_MODES } from '@/stores/chatStore';
import type { ChatMode } from '@/lib/llm';

const LABEL: Record<ChatMode, string> = { ask: 'Ask', agent: 'Agent', plan: 'Plan' };
const HINT: Record<ChatMode, string> = {
  ask: 'Answer only — no tools run.',
  agent: 'Use tools; risky actions ask for approval.',
  plan: 'Draft the steps without acting.',
};

export function ModeSwitch({ sessionId }: { sessionId: string | null }) {
  const stored = useChatStore((s) => (sessionId ? s.modes[sessionId] : undefined));
  const setMode = useChatStore((s) => s.setMode);
  const streaming = useChatStore((s) => s.stream !== null);
  const mode = stored ?? modeFor(sessionId);

  return (
    <div
      role="radiogroup"
      aria-label="Execution mode"
      className="border-border-subtle bg-bg-ink flex h-7 shrink-0 items-center rounded-lg border p-0.5"
    >
      {CHAT_MODES.map((m) => {
        const active = m === mode;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            title={HINT[m]}
            disabled={streaming}
            data-testid={`mode-${m}`}
            onClick={() => setMode(sessionId, m)}
            className={`h-6 rounded-md px-2 text-[11.5px] font-medium transition-colors focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none disabled:cursor-default ${
              active
                ? 'bg-bg-raised text-text-primary'
                : 'text-text-tertiary hover:text-text-secondary'
            }`}
          >
            {LABEL[m]}
          </button>
        );
      })}
    </div>
  );
}
