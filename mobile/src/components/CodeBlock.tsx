import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { highlight } from '../lib/highlight';
import { copyText } from '../lib/clipboard';
import { haptic } from '../lib/haptics';

interface CodeBlockProps {
  code: string;
  lang?: string | undefined;
  /** Long diffs are capped; the sheet scrolls instead of the page. */
  maxHeight?: number | undefined;
  showCopy?: boolean;
}

export function CodeBlock({ code, lang, maxHeight, showCopy = true }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const html = highlight(code, lang);

  const onCopy = async (): Promise<void> => {
    const ok = await copyText(code);
    haptic(ok ? 'success' : 'error');
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div
      className="relative my-2 overflow-hidden rounded-[10px]"
      style={{ border: '1px solid var(--border-default)', background: 'var(--editor-bg)' }}
    >
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span
          className="font-mono text-[11px] uppercase tracking-[0.06em]"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {lang || 'code'}
        </span>
        {showCopy ? (
          <button
            type="button"
            onClick={() => void onCopy()}
            aria-label={copied ? 'Copied' : 'Copy code'}
            className="tap -mr-2 flex items-center gap-1 px-2 text-[12px]"
            style={{ color: copied ? 'var(--success)' : 'var(--text-tertiary)' }}
          >
            {copied ? <Check size={14} strokeWidth={1.6} aria-hidden /> : <Copy size={14} strokeWidth={1.6} aria-hidden />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        ) : null}
      </div>

      <div
        className="scroll-x-quiet"
        style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}
      >
        <pre
          className="min-w-full px-3 py-2.5 font-mono text-[12.5px] leading-[1.55]"
          style={{ color: 'var(--text-primary)' }}
        >
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
    </div>
  );
}
