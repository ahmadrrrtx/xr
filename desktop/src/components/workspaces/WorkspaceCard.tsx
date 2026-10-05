/*
 * Phase 10 — grid card (brief SCREEN 3).
 *
 * 4px kind-gradient strip · emoji/Lucide icon · name 16 · path mono 12 ·
 * stack chips (+N overflow) · last opened · hover actions (Open / Reveal /
 * ⋯) · star becomes a checkbox in multi-select · yellow badge + Locate when
 * the folder is gone. Click → landing; shift-click → range select.
 */
import { memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, FolderOpen, Star } from 'lucide-react';

import { relativeTime } from '@/lib/paletteQuery';
import { cn } from '@/lib/utils';
import {
  WORKSPACE_KIND_META,
  workspaceIcon,
  type Workspace,
} from '@/workspaces/types';

import { StackChips } from './StackChips';
import { WorkspaceMenu } from './WorkspaceMenu';

interface Props {
  ws: Workspace;
  multiSelect: boolean;
  selected: boolean;
  focused: boolean;
  onSelect: (id: string, shift: boolean) => void;
  /** Spawn a real workspace window (dev: honest toast). */
  onLaunch: (ws: Workspace) => void;
  onReveal: (ws: Workspace) => void;
  onLocate: (ws: Workspace) => void;
  onPin: (ws: Workspace) => void;
  onRename: (ws: Workspace) => void;
  onDuplicate: (ws: Workspace) => void;
  onDelete: (ws: Workspace) => void;
}

export const WorkspaceCard = memo(function WorkspaceCard({
  ws,
  multiSelect,
  selected,
  focused,
  onSelect,
  onLaunch,
  onReveal,
  onLocate,
  onPin,
  onRename,
  onDuplicate,
  onDelete,
}: Props) {
  const navigate = useNavigate();
  const meta = WORKSPACE_KIND_META[ws.kind];
  const { emoji, Icon } = workspaceIcon(ws);
  const gv = meta.gradientVar;

  const openLanding = useCallback(
    () => navigate(`/workspaces/${ws.id}`),
    [navigate, ws.id]
  );

  return (
    <div
      data-workspace-card={ws.id}
      data-testid="workspace-card"
      role="button"
      tabIndex={0}
      aria-label={`${ws.name}${ws.pinned ? ' (pinned)' : ''}`}
      aria-pressed={multiSelect ? selected : undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (multiSelect) onSelect(ws.id, e.shiftKey);
        else openLanding();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (multiSelect) onSelect(ws.id, e.shiftKey);
          else openLanding();
        }
      }}
      className={cn(
        'group/card relative flex h-[164px] cursor-pointer flex-col overflow-hidden rounded-xl border text-left transition-all duration-150 outline-none',
        'border-border-subtle hover:border-border-default hover:bg-bg-raised/40',
        focused && 'border-accent shadow-[0_0_0_2px_var(--accent-glow)]',
        selected && 'border-accent/70 shadow-[0_0_0_1px_var(--border-accent)]'
      )}
    >
      {/* kind gradient strip */}
      <div
        aria-hidden
        className="ws-strip h-1 w-full shrink-0"
        style={{
          background: `linear-gradient(90deg, var(--ws-${gv}-from), var(--ws-${gv}-to))`,
          boxShadow: selected || focused ? 'var(--ws-glow)' : undefined,
        }}
      />

      <div className="flex min-h-0 flex-1 flex-col p-3.5">
        {/* icon + star/checkbox */}
        <div className="flex items-start justify-between gap-2">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-lg text-[20px]"
            style={{
              background: `linear-gradient(135deg, color-mix(in oklab, var(--ws-${gv}-from) 18%, transparent), color-mix(in oklab, var(--ws-${gv}-to) 26%, transparent))`,
            }}
          >
            {emoji ? (
              <span aria-hidden>{emoji}</span>
            ) : (
              <Icon className="size-5" strokeWidth={1.5} />
            )}
          </div>
          {multiSelect ? (
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-5 items-center justify-center rounded border text-[11px] font-medium',
                selected
                  ? 'border-accent bg-accent text-accent-contrast'
                  : 'border-border-default text-transparent'
              )}
            >
              ✓
            </span>
          ) : (
            <Star
              onClick={(e) => {
                e.stopPropagation();
                onPin(ws);
              }}
              className={cn(
                'mt-0.5 size-[18px] cursor-pointer transition-colors',
                ws.pinned
                  ? 'fill-[var(--ws-star)] stroke-[var(--ws-star)]'
                  : 'text-text-tertiary hover:text-text-secondary'
              )}
              strokeWidth={1.5}
              aria-label={ws.pinned ? 'Unpin' : 'Pin'}
            />
          )}
        </div>

        {/* name + path */}
        <div className="mt-2.5 min-w-0">
          <div className="truncate text-[15px] leading-5 font-medium">
            {ws.name}
          </div>
          <div
            className={cn(
              'mt-0.5 truncate font-mono text-[11.5px] leading-4',
              ws.pathExists ? 'text-text-tertiary' : 'text-[var(--warning)]'
            )}
            title={ws.path}
          >
            {ws.path}
          </div>
        </div>

        {/* stack chips */}
        <div className="mt-auto pt-1.5">
          <StackChips stack={ws.stack} />
        </div>
      </div>

      {/* footer: last opened + missing badge + hover actions */}
      <div className="border-border-subtle flex h-8 shrink-0 items-center justify-between border-t px-3 opacity-0 transition-opacity duration-150 group-focus-within/card:opacity-100 group-hover/card:opacity-100">
        <span className="text-text-tertiary flex min-w-0 items-center gap-1.5 text-[11px]">
          <span className="shrink-0">
            {ws.lastOpenedAt ? relativeTime(ws.lastOpenedAt) : 'never opened'}
          </span>
          {!ws.pathExists && (
            <span
              data-testid="path-missing-badge"
              className="inline-flex h-[16px] items-center gap-1 rounded bg-[color-mix(in_oklab,var(--warning)_18%,transparent)] px-1.5 text-[10px] font-medium text-[var(--warning)]"
            >
              <AlertTriangle className="size-3" strokeWidth={1.5} />
              path missing
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          <CardAction
            label="Open window"
            onClick={(e) => {
              e.stopPropagation();
              onLaunch(ws);
            }}
          >
            <FolderOpen className="size-3.5" strokeWidth={1.5} />
          </CardAction>
          <CardAction
            label="Reveal in file manager"
            onClick={(e) => {
              e.stopPropagation();
              onReveal(ws);
            }}
          >
            <span aria-hidden className="font-mono text-[11px]">
              ↗
            </span>
          </CardAction>
          <span
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <WorkspaceMenu
              ws={ws}
              onOpen={openLanding}
              onLaunch={(w) => onLaunch(w)}
              onReveal={(w) => onReveal(w)}
              onLocate={(w) => onLocate(w)}
              onPin={(w) => onPin(w)}
              onRename={(w) => onRename(w)}
              onDuplicate={(w) => onDuplicate(w)}
              onDelete={(w) => onDelete(w)}
            />
          </span>
        </span>
      </div>
    </div>
  );
});

function CardAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="hover:bg-bg-raised text-text-secondary hover:text-text-primary flex size-6 cursor-pointer items-center justify-center rounded transition-colors"
    >
      {children}
    </button>
  );
}
