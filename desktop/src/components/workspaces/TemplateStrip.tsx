/*
 * Phase 10 — template strip (brief SCREEN 3).
 *
 * Collapsible row of 180×80 template cards. Drag to scroll (pointer events,
 * no library) + arrow buttons. Non-git cards open the New Workspace modal
 * with that template preselected; the Git card expands an inline URL row.
 */
import { useCallback, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Loader2,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  WORKSPACE_TEMPLATES,
  type WorkspaceTemplate,
} from '@/workspaces/templates';
import { WORKSPACE_KIND_META } from '@/workspaces/types';

interface Props {
  collapsed: boolean;
  onToggleCollapsed: (v: boolean) => void;
  onPick: (template: WorkspaceTemplate) => void;
  onClone: (url: string, name: string | null) => void;
  cloning: boolean;
}

export function TemplateStrip({
  collapsed,
  onToggleCollapsed,
  onPick,
  onClone,
  cloning,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{
    x: number;
    left: number;
    moved: boolean;
    pid: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [gitUrl, setGitUrl] = useState('');
  const [gitName, setGitName] = useState('');

  const scrollBy = useCallback((dx: number) => {
    scrollerRef.current?.scrollBy({ left: dx, behavior: 'smooth' });
  }, []);

  // Drag-to-scroll with a 4px threshold: pointer capture is only taken
  // AFTER the threshold so a plain click still reaches the template button
  // (capturing on pointerdown would retarget the click to the scroller).
  const startDrag = useCallback((e: React.PointerEvent) => {
    const el = scrollerRef.current;
    if (!el || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.current = {
      x: e.clientX,
      left: el.scrollLeft,
      moved: false,
      pid: e.pointerId,
    };
  }, []);

  const moveDrag = useCallback((e: React.PointerEvent) => {
    const el = scrollerRef.current;
    const d = drag.current;
    if (!el || !d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 4) {
      d.moved = true;
      el.setPointerCapture(e.pointerId);
      setDragging(true);
    }
    if (d.moved) el.scrollLeft = d.left - dx;
  }, []);

  const endDrag = useCallback(() => {
    const el = scrollerRef.current;
    const d = drag.current;
    if (el && d?.moved) {
      try {
        el.releasePointerCapture(d.pid);
      } catch {
        /* already released */
      }
    }
    drag.current = null;
    setDragging(false);
  }, []);

  const submitGit = useCallback(() => {
    if (cloning || !gitUrl.trim()) return;
    onClone(gitUrl, gitName.trim() || null);
    setGitUrl('');
    setGitName('');
    setGitOpen(false);
  }, [cloning, gitUrl, gitName, onClone]);

  if (collapsed) {
    return (
      <div className="flex h-9 shrink-0 items-center gap-2 px-4">
        <button
          type="button"
          onClick={() => onToggleCollapsed(false)}
          aria-expanded={false}
          className="hover:bg-bg-raised text-text-secondary hover:text-text-primary flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors"
        >
          <ChevronDown className="size-3.5 rotate-180" strokeWidth={1.5} />
          Templates
          <span className="text-text-tertiary">
            ({WORKSPACE_TEMPLATES.length})
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="border-border-subtle shrink-0 border-b">
      <div className="flex items-center gap-1 px-4 pt-2">
        <button
          type="button"
          onClick={() => onToggleCollapsed(true)}
          aria-expanded
          aria-label="Collapse template strip"
          data-testid="strip-collapse"
          className="hover:bg-bg-raised text-text-tertiary hover:text-text-primary flex size-6 cursor-pointer items-center justify-center rounded-md transition-colors"
        >
          <ChevronDown className="size-3.5" strokeWidth={1.5} />
        </button>
        <span className="text-text-tertiary font-mono text-[10.5px] tracking-wider uppercase">
          Start from
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Scroll templates left"
            onClick={() => scrollBy(-220)}
            className="hover:bg-bg-raised text-text-tertiary hover:text-text-primary flex size-6 cursor-pointer items-center justify-center rounded-md transition-colors"
          >
            <ChevronLeft className="size-3.5" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            aria-label="Scroll templates right"
            onClick={() => scrollBy(220)}
            className="hover:bg-bg-raised text-text-tertiary hover:text-text-primary flex size-6 cursor-pointer items-center justify-center rounded-md transition-colors"
          >
            <ChevronRight className="size-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        data-testid="template-strip"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pt-1.5 pb-2.5 [&::-webkit-scrollbar]:hidden"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      >
        {WORKSPACE_TEMPLATES.map((t) => {
          const gv = WORKSPACE_KIND_META[t.kind].gradientVar;
          const active = t.needsUrl && gitOpen;
          return (
            <button
              key={t.id}
              type="button"
              data-testid={`template-${t.id}`}
              onClick={() => {
                if (drag.current?.moved) return;
                if (t.needsUrl) setGitOpen((v) => !v);
                else onPick(t);
              }}
              aria-expanded={t.needsUrl ? active : undefined}
              className={cn(
                'relative flex h-[80px] w-[180px] shrink-0 cursor-pointer flex-col justify-between overflow-hidden rounded-lg border p-2.5 text-left transition-all duration-150',
                active
                  ? 'border-accent bg-bg-raised/60'
                  : 'border-border-subtle hover:border-border-default hover:bg-bg-raised/40'
              )}
            >
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-[3px]"
                style={{
                  background: `linear-gradient(90deg, var(--ws-${gv}-from), var(--ws-${gv}-to))`,
                }}
              />
              <span className="flex items-center gap-2">
                <span aria-hidden className="text-[18px] leading-none">
                  {t.emoji}
                </span>
                <span className="text-[13px] leading-tight font-medium">
                  {t.label}
                </span>
              </span>
              <span className="text-text-tertiary line-clamp-2 text-[11px] leading-snug">
                {t.blurb}
              </span>
            </button>
          );
        })}
      </div>

      {gitOpen && (
        <div
          data-testid="git-clone-row"
          className="border-border-subtle bg-bg-raised/30 mx-4 mb-2.5 flex items-center gap-2 rounded-lg border px-2.5 py-2"
        >
          <GitBranch
            className="text-text-tertiary size-4 shrink-0"
            strokeWidth={1.5}
          />
          <input
            data-testid="git-url-input"
            autoFocus
            value={gitUrl}
            onChange={(e) => setGitUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitGit();
              if (e.key === 'Escape') setGitOpen(false);
            }}
            placeholder="https://github.com/owner/repo"
            className="placeholder:text-text-tertiary focus:border-border-default h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 font-mono text-[12px] outline-none"
          />
          <input
            data-testid="git-name-input"
            value={gitName}
            onChange={(e) => setGitName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitGit();
            }}
            placeholder="name (optional)"
            className="placeholder:text-text-tertiary focus:border-border-default h-7 w-36 rounded-md border border-transparent bg-transparent px-2 text-[12px] outline-none"
          />
          <button
            type="button"
            data-testid="git-clone-btn"
            disabled={cloning || !gitUrl.trim()}
            onClick={submitGit}
            className="bg-accent text-accent-contrast h-7 shrink-0 cursor-pointer rounded-md px-3 text-[12px] font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {cloning ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={1.5} />
            ) : (
              'Clone'
            )}
          </button>
          <button
            type="button"
            aria-label="Cancel clone"
            onClick={() => setGitOpen(false)}
            className="hover:bg-bg-raised text-text-tertiary hover:text-text-primary flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors"
          >
            <X className="size-3.5" strokeWidth={1.5} />
          </button>
        </div>
      )}
    </div>
  );
}
