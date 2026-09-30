/*
 * Welcome / empty state (Phase 4) — centered Avatar (80px, idle), greeting
 * with the user's name, 4 suggestion chips. A chip starts a new session and
 * sends the prompt as the first message.
 */
import { Code2, FolderOpen, Mail, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Avatar } from '@/components/brand/Avatar';
import { useChatStore } from '@/stores/chatStore';
import { useSessionsStore } from '@/stores/sessionsStore';
import { useUIStore } from '@/stores/ui';

const SUGGESTIONS = [
  { icon: Code2, label: 'Explain a codebase' },
  { icon: Search, label: 'Research a topic' },
  { icon: Mail, label: 'Draft an email' },
  { icon: FolderOpen, label: 'Open workspace' },
];

export function WelcomeState() {
  const userName = useUIStore((s) => s.userName);
  const navigate = useNavigate();
  const sendMessage = useChatStore((s) => s.sendMessage);

  const start = async (label: string) => {
    const session = await useSessionsStore.getState().createNewSession();
    navigate(`/chat/${session.id}`);
    void sendMessage(label);
  };

  const first = userName.trim();

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
      <Avatar size="lg" state="idle" />
      <h1 className="text-text-primary mt-6 text-[22px] font-semibold tracking-[-0.01em]">
        Hey{first ? ` ${first}` : ''}. What are we building today?
      </h1>
      <div className="mt-6 flex max-w-xl flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => void start(s.label)}
            className="border-border-subtle bg-bg-ink/60 text-text-secondary hover:border-border-default hover:text-text-primary flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium transition-colors focus-visible:ring-accent focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <s.icon aria-hidden="true" className="size-4" strokeWidth={1.5} />
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
