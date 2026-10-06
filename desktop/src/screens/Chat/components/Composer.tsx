/*
 * Composer (Phase 4) — auto-grow textarea (Enter send · Shift+Enter newline ·
 * IME-safe via isComposing/229), paperclip attach (Tauri dialog / browser
 * file input), paste-image, drag-drop overlay handled by the screen, mic +
 * voice-theater toasts (real voice: 15/16), send ⇄ stop while streaming,
 * model chip + token counter below.
 */
import { ArrowRight, Mic, Paperclip, Square, Waves } from 'lucide-react';
import TextareaAutosize from 'react-textarea-autosize';
import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { modelInfo } from '@/budget/models';
import { isTauri } from '@/lib/tauri';
import { MAX_ATTACHMENT_BYTES, useChatStore, type FileAttachment } from '@/stores/chatStore';
import { useEngineStore } from '@/stores/engineStore';
import { newId, useSessionsStore } from '@/stores/sessionsStore';
import { AttachmentStrip } from './AttachmentStrip';
import { ModeSwitch } from './ModeSwitch';
import { ModelPicker } from './ModelPicker';

/** Rough chars/token estimate for the composer counter (the engine reports real usage). */
const estimateTokens = (chars: number): number => Math.ceil(chars / 4);

/** Text-like files only: the engine reads their content inline. */
const TEXT_EXT = /\.(txt|md|markdown|json|jsonl|csv|tsv|ya?ml|toml|ini|cfg|conf|log|xml|html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|bash|zsh|fish|sql|graphql|env|gitignore|dockerfile|makefile|lock|diff|patch|tex|rst|org)$/i;

function isTextFile(f: File): boolean {
  if (f.type.startsWith('text/')) return true;
  if (/^application\/(json|xml|x-yaml|yaml|toml|javascript|typescript|x-sh)/.test(f.type)) return true;
  return TEXT_EXT.test(f.name);
}

export function Composer({
  sessionId,
}: {
  sessionId: string | null;
}) {
  const [text, setText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sendMessage = useChatStore((s) => s.sendMessage);
  const cancelGeneration = useChatStore((s) => s.cancelGeneration);
  const attachments = useChatStore((s) => s.attachments);
  const addAttachment = useChatStore((s) => s.addAttachment);
  const removeAttachment = useChatStore((s) => s.removeAttachment);
  const stream = useChatStore((s) => s.stream);
  const engineStatus = useEngineStore((s) => s.status);
  const engineFailures = useEngineStore((s) => s.failures);
  const engineDown =
    (engineStatus === 'down' && engineFailures >= 2) || engineStatus === 'unauthorized';
  const sessionModel = useSessionsStore(
    (s) => s.sessions.find((x) => x.id === sessionId)?.model ?? null,
  );
  const contextK = modelInfo(sessionModel ?? '').contextK || 128;

  const streaming = stream !== null;
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !streaming && !engineDown;

  // ↑ with an empty composer prefills the last user message (edit-and-resend).
  const prefillLast = () => {
    const st = useChatStore.getState();
    const list = sessionId ? (st.messages[sessionId] ?? []) : [];
    const lastUser = [...list].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      setText(
        lastUser.content.replace(/\n\[Attached: [^\]]+\]\n?/g, '\n').trim(),
      );
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'ArrowUp' && text.length === 0) {
      e.preventDefault();
      prefillLast();
      return;
    }
    if (e.key !== 'Enter') return;
    // IME composition: Enter confirms the candidate — never sends.
    const native = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
    if (native.isComposing || e.keyCode === 229) return;
    if (e.shiftKey) return; // newline
    e.preventDefault();
    if (canSend) {
      void send();
    }
  };

  const send = async () => {
    const value = text;
    setText('');
    await sendMessage(value);
  };

  const pickFiles = async () => {
    if (isTauri()) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const result = await open({ multiple: true, title: 'Attach text files' });
        if (!result) return;
        const paths = Array.isArray(result) ? result : [result];
        const { readFile } = await import('@tauri-apps/plugin-fs');
        for (const p of paths) {
          const name = String(p).split(/[\\/]/).pop() ?? 'file';
          const bytes = await readFile(String(p));
          const file = new File([bytes], name);
          ingestFiles([file]);
        }
        return;
      } catch {
        /* fall through to browser input */
      }
    }
    fileInputRef.current?.click();
  };

  const ingestFiles = (files: File[]) => {
    for (const f of files) {
      if (f.size > MAX_ATTACHMENT_BYTES) {
        toast(`${f.name} is too large`, { description: 'Attachments are limited to 1 MB of text.' });
        continue;
      }
      if (!isTextFile(f)) {
        toast(`${f.name} skipped`, {
          description: 'Only text files can be attached for now (images and binaries come later).',
        });
        continue;
      }
      const att: FileAttachment = { id: newId(), name: f.name, size: f.size, type: f.type || 'text/plain' };
      const reader = new FileReader();
      reader.onload = () => {
        const content = String(reader.result ?? '');
        // Binary disguised with a text extension → NUL bytes; refuse honestly.
        if (content.includes('\u0000')) {
          toast(`${f.name} skipped`, { description: 'That file is not plain text.' });
          return;
        }
        addAttachment({ ...att, text: content });
      };
      reader.onerror = () => toast(`Could not read ${f.name}`);
      reader.readAsText(f);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length > 0) {
      e.preventDefault();
      ingestFiles(files);
    }
  };

  // Drag-drop overlay (events land on the composer wrapper).
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) ingestFiles(files);
  };

  // ⌘/ focuses the composer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Autofocus on mount / session switch.
  useEffect(() => {
    inputRef.current?.focus();
  }, [sessionId]);

  const tokens = estimateTokens(text.length);
  const ratio = tokens / (contextK * 1000);

  return (
    <div className="w-full px-6 pb-6">
      <div className="mx-auto w-full max-w-[820px]">
        <AttachmentStrip attachments={attachments} onRemove={removeAttachment} />

        <div
          className="border-border-default bg-bg-ink focus-within:border-accent relative rounded-2xl border transition-[border-color,box-shadow] duration-200"
          onDragEnter={(e) => {
            e.preventDefault();
            dragCounter.current += 1;
            if (dragCounter.current === 1) setDragOver(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            e.preventDefault();
            dragCounter.current -= 1;
            if (dragCounter.current === 0) setDragOver(false);
          }}
          onDrop={onDrop}
        >
          {dragOver && (
            <div className="bg-accent/10 border-accent text-accent absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed text-[16px] font-medium">
              Drop files to attach
            </div>
          )}

          <div className="flex items-end gap-1 p-2">
            <button
              type="button"
              onClick={() => void pickFiles()}
              aria-label="Attach files"
              className="text-text-tertiary hover:bg-bg-raised hover:text-text-secondary flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none"
            >
              <Paperclip aria-hidden="true" className="size-[18px]" strokeWidth={1.5} />
            </button>

            <TextareaAutosize
              ref={inputRef}
              id="xr-composer"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              placeholder={engineDown ? 'Engine not running — start it to chat' : 'Message XR...'}
              // The draft lives in state, so disabling the field while the
              // engine is down loses nothing; it re-enables on the next probe.
              disabled={engineDown}
              aria-label="Message XR"
              aria-describedby={engineDown ? 'xr-composer-engine-hint' : undefined}
              minRows={1}
              maxRows={8}
              cacheMeasurements
              className="text-text-primary placeholder:text-text-tertiary/70 max-h-[200px] min-h-[44px] flex-1 resize-none bg-transparent px-1 py-2.5 text-[15px] leading-relaxed outline-none"
            />

            <button
              type="button"
              onClick={() =>
                toast('Voice coming in Phase 15', {
                  description: 'Dictation, wake word and the Theater arrive later.',
                })
              }
              aria-label="Voice input (coming in Phase 15)"
              className="text-text-tertiary hover:bg-bg-raised hover:text-text-secondary flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none"
            >
              <Mic aria-hidden="true" className="size-[18px]" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {engineDown && (
          <p id="xr-composer-engine-hint" className="sr-only">
            The XR engine is not running; sending is disabled until it is back.
          </p>
        )}

        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <ModeSwitch sessionId={sessionId} />
            <ModelPicker sessionId={sessionId} />
          </div>

          <div className="flex items-center gap-2">
            {ratio > 0.75 && (
              <span
                className="font-mono text-[11px]"
                style={{
                  color:
                    ratio >= 0.98
                      ? 'var(--danger)'
                      : ratio >= 0.9
                        ? 'var(--warning)'
                        : 'var(--text-tertiary)',
                }}
                aria-live="off"
              >
                {(tokens / 1000).toFixed(1)}K / {contextK}K tokens
              </span>
            )}
            <button
              type="button"
              onClick={() =>
                toast('Voice theater in Phase 16', {
                  description: 'The full-screen voice session arrives later.',
                })
              }
              aria-label="Open voice theater (coming in Phase 16)"
              className="text-text-tertiary hover:bg-bg-raised hover:text-text-secondary flex size-9 items-center justify-center rounded-lg transition-colors focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none"
            >
              <Waves aria-hidden="true" className="size-[18px]" strokeWidth={1.5} />
            </button>
            {streaming ? (
              <motion.button
                type="button"
                onClick={cancelGeneration}
                aria-label="Stop generating"
                data-testid="chat-stop"
                className="bg-bg-raised text-danger hover:bg-border-default flex size-10 items-center justify-center rounded-full transition-colors focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none"
                whileTap={{ scale: 0.9 }}
              >
                <Square aria-hidden="true" className="size-4 fill-current" strokeWidth={1.5} />
              </motion.button>
            ) : (
              <motion.button
                type="button"
                onClick={() => void send()}
                disabled={!canSend}
                aria-label={engineDown ? 'Send message (engine not running)' : 'Send message'}
                data-testid="chat-send"
                className={
                  canSend
                    ? 'bg-accent text-accent-contrast flex size-10 items-center justify-center rounded-full transition-[background-color,transform]'
                    : 'bg-bg-raised text-text-tertiary flex size-10 scale-95 items-center justify-center rounded-full transition-[background-color,transform]'
                }
                style={
                  canSend
                    ? { boxShadow: '0 0 16px -4px var(--accent-glow)' }
                    : undefined
                }
                whileTap={{ scale: 0.9 }}
              >
                <ArrowRight aria-hidden="true" className="size-[18px]" strokeWidth={1.5} />
              </motion.button>
            )}
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          ingestFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
}
