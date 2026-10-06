/*
 * DiffCard (Phase 17) — a unified diff the user can review hunk by hunk.
 *
 * GitHub-PR-like and muted: filename + path, per-hunk ✓/✗ on hover (SR-visible
 * always), [Apply diff] cyan / [Explain] / [Copy]. Nothing is written until
 * Apply, and Apply itself goes through the engine's approval plane.
 */
import { Check, Copy, MessageSquareText, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { basenameOf, dirnameOf, type DiffBlock } from '@/lib/builderCore';
import { cn } from '@/lib/utils';

import { diffCardFocus } from '../lib/diffFocus';

export function DiffCard({
  block,
  pending,
  onApply,
  onExplain,
  onOpen,
}: {
  block: DiffBlock;
  /** Still streaming — show the hunks, hold the buttons. */
  pending: boolean;
  onApply: (hunks: number[] | undefined) => Promise<{ ok: boolean; applied: number }>;
  onExplain: (block: DiffBlock) => void;
  onOpen: (path: string) => void;
}) {
  const [rejected, setRejected] = useState<Set<number>>(() => new Set());
  const [state, setState] = useState<'idle' | 'applying' | 'applied'>('idle');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const total = block.hunks.length;
  const selectedCount = total - rejected.size;
  const stats = useMemo(() => block.hunks.reduce((acc, h) => ({ add: acc.add + h.added, del: acc.del + h.removed }), { add: 0, del: 0 }), [block.hunks]);

  const handle = useMemo(
    () => ({
      acceptAll: () => setRejected(new Set()),
      rejectAll: () => setRejected(new Set(block.hunks.map((h) => h.index))),
    }),
    [block.hunks],
  );
  useEffect(() => {
    diffCardFocus.current = handle;
  }, [handle]);

  const toggle = (index: number) =>
    setRejected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const apply = async () => {
    if (state !== 'idle' || selectedCount === 0) return;
    setState('applying');
    const hunks = rejected.size ? block.hunks.filter((h) => !rejected.has(h.index)).map((h) => h.index) : undefined;
    const r = await onApply(hunks);
    setState(r.ok ? 'applied' : 'idle');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(block.patch);
      toast('Diff copied');
    } catch {
      toast('Could not copy', { description: 'Clipboard access was blocked.' });
    }
  };

  const name = block.path ? basenameOf(block.path) : 'untitled';
  const dir = block.path ? dirnameOf(block.path) : '';

  return (
    <div ref={rootRef} className="xb-diff" data-testid="builder-diff-card" onMouseEnter={() => (diffCardFocus.current = handle)} onFocus={() => (diffCardFocus.current = handle)}>
      <div className="xb-diff-head">
        {block.path ? (
          <button type="button" className="xb-diff-name hover:underline" onClick={() => onOpen(block.path ?? '')} title={`Open ${block.path}`}>
            {name}
          </button>
        ) : (
          <span className="xb-diff-name">{name}</span>
        )}
        {dir ? <span className="xb-diff-path">{dir}/</span> : null}
        {block.isNewFile ? <span className="xb-chip">new file</span> : null}
        {block.isDelete ? <span className="xb-chip">delete</span> : null}
        <span className="xb-diff-stats" aria-label={`${stats.add} added, ${stats.del} removed`}>
          <span className="add">+{stats.add}</span>
          <span className="del">−{stats.del}</span>
        </span>
      </div>
      {block.hunks.map((h, i) => {
        const off = rejected.has(h.index);
        return (
          <section key={h.index} className={cn('xb-hunk', off && 'is-rejected')} aria-label={`Hunk ${i + 1} of ${total}: ${h.added} added, ${h.removed} removed${off ? ', skipped' : ''}`}>
            <div className="xb-hunk-header">
              <span>{h.header}</span>
              <span className="xb-hunk-actions">
                <button
                  type="button"
                  className="xb-icon-btn"
                  aria-pressed={!off}
                  aria-label={`Keep hunk ${i + 1}`}
                  title="Keep this hunk"
                  disabled={state !== 'idle'}
                  onClick={() => off && toggle(h.index)}
                >
                  <Check size={12} />
                </button>
                <button
                  type="button"
                  className="xb-icon-btn"
                  aria-pressed={off}
                  aria-label={`Skip hunk ${i + 1}`}
                  title="Skip this hunk"
                  disabled={state !== 'idle'}
                  onClick={() => !off && toggle(h.index)}
                >
                  <X size={12} />
                </button>
              </span>
            </div>
            <div className="xb-hunk-body">
              {h.lines.map((line, j) => {
                const sign = line[0] ?? ' ';
                const kind = sign === '+' ? 'is-add' : sign === '-' ? 'is-del' : '';
                return (
                  <div key={j} className={cn('xb-diff-line', kind)}>
                    <span className="sign" aria-hidden="true">
                      {sign === ' ' ? '' : sign}
                    </span>
                    {kind ? <span className="sr-only">{kind === 'is-add' ? 'added: ' : 'removed: '}</span> : null}
                    <span>{line.slice(1) || ' '}</span>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      <div className="xb-diff-foot">
        <button type="button" className="xb-primary" disabled={pending || state !== 'idle' || selectedCount === 0 || !block.path} onClick={() => void apply()} data-testid="builder-apply-diff">
          {state === 'applied' ? (
            <>
              <Check size={12} /> Applied
            </>
          ) : state === 'applying' ? (
            'Applying…'
          ) : rejected.size ? (
            `Apply ${selectedCount} of ${total}`
          ) : (
            'Apply diff'
          )}
        </button>
        <button type="button" className="xb-ghost" disabled={pending} onClick={() => onExplain(block)}>
          <MessageSquareText size={12} /> Explain
        </button>
        <button type="button" className="xb-ghost" onClick={() => void copy()}>
          <Copy size={12} /> Copy
        </button>
        <span className="xb-note">{pending ? 'Streaming…' : !block.path ? 'No file path in this diff' : selectedCount === 0 ? 'All hunks skipped' : 'Nothing is written until you apply'}</span>
      </div>
    </div>
  );
}
