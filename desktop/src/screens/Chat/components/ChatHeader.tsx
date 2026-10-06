/*
 * Conversation header (Phase 14): editable title · model chip (opens the
 * picker) · live counters (tokens / cost for this conversation, from the
 * engine's reported usage and the governor's recorded cost) · Export as
 * Markdown · Clear (confirmed). Sits above the message list; 44px, calm.
 */
import { Download, Eraser, Pencil } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { fmtUsd } from '@/budget/core';
import { modelInfo } from '@/budget/models';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { chatDb, type ChatMessage } from '@/lib/chat-db';
import { useChatStore } from '@/stores/chatStore';
import { useSessionsStore } from '@/stores/sessionsStore';
import { ModelPicker } from './ModelPicker';

const NO_MESSAGES: ChatMessage[] = [];

/** Markdown transcript — what a user would paste elsewhere. */
export function transcriptMarkdown(title: string, messages: ChatMessage[]): string {
  const lines: string[] = [`# ${title}`, ''];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const who = m.role === 'user' ? 'You' : 'XR';
    const when = new Date(m.createdAt).toISOString();
    lines.push(`## ${who} · ${when}`, '');
    if (m.metadata?.budget?.kind === 'blocked') {
      lines.push(`_Blocked by the budget governor: ${m.metadata.budget.reason ?? 'limit reached'}_`, '');
      continue;
    }
    if (m.metadata?.error && !m.content) {
      lines.push(`_Failed: ${m.metadata.error.message}_`, '');
      continue;
    }
    const segs = m.metadata?.segments ?? [{ type: 'text' as const, text: m.content }];
    for (const seg of segs) {
      if (seg.type === 'text') {
        lines.push(seg.text.trim(), '');
      } else {
        const t = m.toolCalls?.[seg.index];
        if (!t) continue;
        lines.push(`> **Tool:** \`${t.tool}\` — ${t.summary} (${t.denied ? 'denied' : t.blocked ? 'blocked' : t.status})`);
        if (t.input !== undefined) lines.push('> ```json', ...JSON.stringify(t.input, null, 2).split('\n').map((l) => `> ${l}`), '> ```');
        if (t.output) lines.push('>', ...t.output.split('\n').slice(0, 40).map((l) => `> ${l}`));
        lines.push('');
      }
    }
    if (m.metadata?.model) lines.push(`<sub>${modelInfo(m.metadata.model).name}${m.metadata.usage ? ` · ${m.metadata.usage.inTokens + m.metadata.usage.outTokens} tokens` : ''}</sub>`, '');
  }
  return lines.join('\n').trim() + '\n';
}

export function ChatHeader({ sessionId }: { sessionId: string }) {
  const session = useSessionsStore((s) => s.sessions.find((x) => x.id === sessionId));
  const renameSession = useSessionsStore((s) => s.renameSession);
  const messages = useChatStore((s) => s.messages[sessionId] ?? NO_MESSAGES);
  const stream = useChatStore((s) => (s.stream?.sessionId === sessionId ? s.stream : null));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const totals = useMemo(() => {
    let tokens = 0;
    let cost = 0;
    let measured = false;
    for (const m of messages) {
      if (m.metadata?.usage) {
        tokens += m.metadata.usage.inTokens + m.metadata.usage.outTokens;
        measured = true;
      }
      if (m.metadata?.budget?.costUsd) cost += m.metadata.budget.costUsd;
    }
    if (stream?.usage) {
      tokens += stream.usage.inTokens + stream.usage.outTokens;
      measured = true;
    }
    if (stream?.budget?.costUsd) cost += stream.budget.costUsd;
    return { tokens, cost, measured };
  }, [messages, stream]);

  const title = session?.title ?? 'New chat';
  const localModel = modelInfo(session?.model ?? '').local;

  const saveTitle = async (): Promise<void> => {
    setEditing(false);
    const t = draft.trim();
    if (!t || t === title) return;
    await renameSession(sessionId, t.slice(0, 80));
  };

  const exportMd = async (): Promise<void> => {
    const md = transcriptMarkdown(title, messages);
    const name = `${title.replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'chat'}.md`;
    try {
      const { isTauri } = await import('@/lib/tauri');
      if (isTauri()) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const path = await save({ defaultPath: name, filters: [{ name: 'Markdown', extensions: ['md'] }] });
        if (!path) return;
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        await writeTextFile(path, md);
        toast('Exported', { description: path });
        return;
      }
    } catch {
      /* fall back to a download */
    }
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    toast('Exported', { description: name });
  };

  const clear = async (): Promise<void> => {
    setConfirmClear(false);
    if (stream) useChatStore.getState().cancelGeneration();
    for (const m of messages) await chatDb.deleteMessage(m.id);
    useChatStore.setState((st) => ({
      messages: { ...st.messages, [sessionId]: [] },
      hasMore: { ...st.hasMore, [sessionId]: false },
    }));
    toast('Conversation cleared');
  };

  return (
    <div
      className="border-border-subtle flex h-11 shrink-0 items-center gap-2 border-b pr-3 pl-14"
      data-testid="chat-header"
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void saveTitle()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void saveTitle();
            if (e.key === 'Escape') setEditing(false);
          }}
          aria-label="Conversation title"
          maxLength={80}
          className="text-text-primary focus-visible:ring-accent min-w-0 flex-1 rounded-md bg-transparent px-1 text-[13.5px] font-semibold focus-visible:ring-2 focus-visible:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(title);
            setEditing(true);
          }}
          title="Rename conversation"
          className="group/title text-text-primary hover:bg-bg-raised flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[13.5px] font-semibold"
        >
          <span className="truncate">{title}</span>
          <Pencil size={12} strokeWidth={1.75} aria-hidden="true" className="text-text-tertiary shrink-0 opacity-0 group-hover/title:opacity-100" />
        </button>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <ModelPicker
          sessionId={sessionId}
          trigger={(label) => (
            <button
              type="button"
              className="border-border-subtle bg-bg-ink text-text-secondary hover:text-text-primary focus-visible:ring-accent h-6 max-w-[200px] truncate rounded-full border px-2.5 text-[11.5px] focus-visible:ring-2 focus-visible:outline-none"
              aria-label={`Model: ${label}. Change model`}
              data-testid="chat-header-model"
            >
              {label}
            </button>
          )}
        />
        <span
          className="text-text-tertiary font-mono text-[11px] tabular-nums"
          data-testid="chat-counters"
          title={totals.measured ? 'Tokens reported by the provider' : 'The provider has not reported token counts'}
          aria-live="off"
        >
          {totals.measured ? `${totals.tokens.toLocaleString()} tok` : '— tok'}
          {' · '}
          {localModel && totals.cost === 0 ? <span className="text-text-tertiary">local</span> : fmtUsd(totals.cost, { precise: true })}
        </span>
        <button
          type="button"
          onClick={() => void exportMd()}
          disabled={messages.length === 0}
          aria-label="Export conversation as Markdown"
          title="Export as Markdown"
          className="text-text-tertiary hover:text-text-primary hover:bg-bg-raised flex size-7 items-center justify-center rounded-md disabled:opacity-40"
        >
          <Download size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setConfirmClear(true)}
          disabled={messages.length === 0}
          aria-label="Clear conversation"
          title="Clear conversation"
          className="text-text-tertiary hover:text-text-primary hover:bg-bg-raised flex size-7 items-center justify-center rounded-md disabled:opacity-40"
        >
          <Eraser size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes {messages.length} message{messages.length === 1 ? '' : 's'} from “{title}”. The session stays; this
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void clear()}>Clear</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
