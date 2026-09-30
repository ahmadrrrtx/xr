/*
 * Syntax-highlighted code block (Phase 4).
 *
 * Shiki (lazy singleton, dual palettes as CSS vars — see lib/highlight.ts)
 * with a graceful plain <pre> while loading / for unknown languages.
 * Header: language label left, copy right (hover). Max height 480px.
 */
import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { highlightToHtml, resolveLang } from '@/lib/highlight';

export function CodeBlock({ code, langTag }: { code: string; langTag: string }) {
  const lang = resolveLang(langTag);
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(0);

  useEffect(() => {
    let alive = true;
    void highlightToHtml(code, lang).then((out) => {
      if (alive) setHtml(out);
    });
    return () => {
      alive = false;
    };
  }, [code, lang]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
      toast('Copied');
    } catch {
      toast('Copy failed — clipboard unavailable');
    }
  };

  return (
    <div
      className="group/code border-border-subtle bg-black/50 my-3 overflow-hidden rounded-lg border"
      role="code"
      aria-label={`Code block${lang !== 'text' ? ` (${lang})` : ''}`}
    >
      <div className="flex h-8 items-center justify-between px-3">
        <span className="text-text-tertiary font-mono text-[11px] tracking-wider uppercase select-none">
          {langTag || 'text'}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label="Copy code"
          className="text-text-tertiary hover:text-text-primary flex items-center gap-1 rounded px-1.5 py-1 text-[11px] opacity-0 transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100"
        >
          {copied ? (
            <Check aria-hidden="true" className="text-success size-3.5" strokeWidth={1.5} />
          ) : (
            <Copy aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
          )}
        </button>
      </div>
      {html ? (
        <div
          className="max-h-[480px] overflow-auto px-4 py-3 [&_pre]:bg-transparent! [&_pre]:font-mono! [&_pre]:text-[13px]! [&_pre]:leading-6!"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="max-h-[480px] overflow-auto px-4 py-3 font-mono text-[13px] leading-6">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
