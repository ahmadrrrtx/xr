import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic, Paperclip, Square } from 'lucide-react';
import { haptic } from '../lib/haptics';

interface ComposerProps {
  onSend: (text: string) => void;
  onVoice: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  placeholder?: string;
}

const MAX_HEIGHT = 120;

export function Composer({
  onSend,
  onVoice,
  onStop,
  streaming,
  disabled,
  placeholder = 'Message XR',
}: ComposerProps) {
  const [value, setValue] = useState('');
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  // Grow from 44px up to 120px, then scroll internally.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, MAX_HEIGHT);
    el.style.height = `${Math.max(44, next)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [value]);

  const canSend = value.trim().length > 0 && !streaming && !disabled;

  const send = (): void => {
    if (!canSend) return;
    haptic('medium');
    onSend(value.trim());
    setValue('');
  };

  return (
    <div
      className="glass px-3 pb-safe pt-2"
      style={{ borderTop: '1px solid var(--border-subtle)' }}
    >
      <div className="flex items-end gap-2">
        {/* Attachments are deliberately not in Phase 28 — tooltip says so. */}
        <button
          type="button"
          disabled
          aria-label="Attachments coming soon"
          title="Coming soon"
          className="tap mb-[2px] flex items-center justify-center rounded-full opacity-40"
        >
          <Paperclip size={20} strokeWidth={1.5} style={{ color: 'var(--text-tertiary)' }} aria-hidden />
        </button>

        <div
          className="flex min-h-[44px] flex-1 items-end rounded-[20px] px-3.5 py-[9px]"
          style={{
            background: 'color-mix(in srgb, var(--bg-raised) 78%, transparent)',
            border: '1px solid var(--border-default)',
          }}
        >
          <textarea
            ref={areaRef}
            rows={1}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder={placeholder}
            aria-label="Message"
            className="w-full resize-none bg-transparent text-[16px] leading-[1.4] outline-none placeholder:opacity-60"
            style={{ color: 'var(--text-primary)', maxHeight: MAX_HEIGHT }}
          />
        </div>

        {streaming ? (
          <button
            type="button"
            onClick={() => {
              haptic('warning');
              onStop();
            }}
            aria-label="Stop generating"
            className="tap mb-[2px] flex items-center justify-center rounded-full"
            style={{ background: 'color-mix(in srgb, var(--danger) 18%, transparent)' }}
          >
            <Square size={17} strokeWidth={2} fill="currentColor" style={{ color: 'var(--danger)' }} aria-hidden />
          </button>
        ) : canSend ? (
          <button
            type="button"
            onClick={send}
            aria-label="Send message"
            className="tap mb-[2px] flex items-center justify-center rounded-full"
            style={{ background: 'var(--accent)' }}
          >
            <ArrowUp size={20} strokeWidth={2.2} style={{ color: 'var(--bg-void)' }} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              haptic('light');
              onVoice();
            }}
            aria-label="Voice note"
            className="tap mb-[2px] flex items-center justify-center rounded-full"
          >
            <Mic size={20} strokeWidth={1.6} style={{ color: 'var(--accent)' }} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
