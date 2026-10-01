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

import { isTauri } from '@/lib/tauri';
import { useChatStore, type FileAttachment } from '@/stores/chatStore';
import { newId } from '@/stores/sessionsStore';
import { AttachmentStrip } from './AttachmentStrip';
import { ModelPicker } from './ModelPicker';

const CONTEXT_WINDOW = 128_000; // tokens (mock assumption per brief)
/** Rough chars/token estimate — a real tokenizer lands with the backend. */
const estimateTokens = (chars: number): number => Math.ceil(chars / 4);

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

  const streaming = stream !== null;
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !streaming;

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
        const result = await open({ multiple: true, title: 'Attach files' });
        if (!result) return;
        const paths = Array.isArray(result) ? result : [result];
        for (const p of paths) {
          const name = String(p).split(/[\\/]/).pop() ?? 'file';
          addAttachment({ id: newId(), name, size: 0, type: 'file' });
        }
        toast('File attachments will send with your message in a future update.');
        return;
      } catch {
        /* fall through to browser input */
      }
    }
    fileInputRef.current?.click();
  };

  const ingestFiles = (files: File[]) => {
    for (const f of files) {
      const isImage = f.type.startsWith('image/');
      const att: FileAttachment = {
        id: newId(),
        name: f.name,
        size: f.size,
        type: f.type,
      };
      if (isImage && f.size < 2 * 1024 * 1024) {
        const reader = new FileReader();
        reader.onload = () => {
          addAttachment({ ...att, preview: String(reader.result) });
        };
        reader.readAsDataURL(f);
        continue;
      }
      addAttachment(att);
    }
    if (files.length > 0) {
      toast('File attachments will send with your message in a future update.');
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
  const ratio = tokens / CONTEXT_WINDOW;

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
              placeholder="Message XR..."
              aria-label="Message XR"
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

        <div className="mt-2 flex items-center justify-between gap-3">
          <ModelPicker sessionId={sessionId} />

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
                {(tokens / 1000).toFixed(1)}K / 128K tokens
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
                className="bg-bg-raised text-text-primary hover:bg-border-default flex size-10 items-center justify-center rounded-full transition-colors"
                whileTap={{ scale: 0.9 }}
              >
                <Square aria-hidden="true" className="size-4 fill-current" strokeWidth={1.5} />
              </motion.button>
            ) : (
              <motion.button
                type="button"
                onClick={() => void send()}
                disabled={!canSend}
                aria-label="Send message"
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
