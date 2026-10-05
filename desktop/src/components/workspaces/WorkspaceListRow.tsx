/* Phase 10 — list-mode row (denser than the card, same data). */
import { memo } from 'react';
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
  onLaunch: (ws: Workspace) => void;
  onReveal: (ws: Workspace) => void;
  onLocate: (ws: Workspace) => void;
  onPin: (ws: Workspace) => void;
  onRename: (ws: Workspace) => void;
  onDuplicate: (ws: Workspace) => void;
  onDelete: (ws: Workspace) => void;
}

export const WorkspaceListRow = memo(function WorkspaceListRow({
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

  return (
    <div
      data-workspace-card={ws.id}
      data-testid="workspace-list-row"
      role="button"
      tabIndex={0}
      aria-label={`${ws.name}${ws.pinned ? ' (pinned)' : ''}`}
      aria-pressed={multiSelect ? selected : undefined}
      onClick={(e) => {
        if (multiSelect) {
          onSelect(ws.id, e.shiftKey);
        } else {
          navigate(`/workspaces/${ws.id}`);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (multiSelect) onSelect(ws.id, e.shiftKey);
          else navigate(`/workspaces/${ws.id}`);
        }
      }}
      className={cn(
        'group/row relative flex h-[52px] cursor-pointer items-center gap-3 rounded-lg border px-3 transition-all duration-150 outline-none',
        'border-border-subtle hover:border-border-default hover:bg-bg-raised/40',
        focused && 'border-accent shadow-[0_0_0_2px_var(--accent-glow)]',
        selected && 'border-accent/70'
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-2 left-0 w-[3px] rounded-full"
        style={{
          background: `linear-gradient(180deg, var(--ws-${gv}-from), var(--ws-${gv}-to))`,
        }}
      />
      <span className="flex w-6 shrink-0 items-center justify-center text-[16px]">
        {emoji ? (
          <span aria-hidden>{emoji}</span>
        ) : (
          <Icon className="size-4" strokeWidth={1.5} />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] leading-tight font-medium">
          {ws.name}
          {!ws.pathExists && (
            <span
              data-testid="path-missing-badge"
              className="ml-2 inline-flex h-[15px] items-center gap-1 rounded bg-[color-mix(in_oklab,var(--warning)_18%,transparent)] px-1.5 align-middle text-[10px] font-medium text-[var(--warning)]"
            >
              <AlertTriangle className="size-2.5" strokeWidth={1.5} />
              path missing
            </span>
          )}
        </span>
        <span
          className="text-text-tertiary block truncate font-mono text-[11px]"
          title={ws.path}
        >
          {ws.path}
        </span>
      </span>

      <StackChips
        stack={ws.stack}
        max={2}
        className="hidden w-44 shrink-0 md:flex"
      />

      <span className="text-text-tertiary hidden w-24 shrink-0 text-right text-[11px] lg:block">
        {ws.lastOpenedAt ? relativeTime(ws.lastOpenedAt) : 'never'}
      </span>

      <span className="flex shrink-0 items-center gap-0.5">
        {multiSelect ? (
          <span
            aria-hidden
            className={cn(
              'flex size-5 items-center justify-center rounded border text-[11px] font-medium',
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
              'size-4 cursor-pointer transition-colors',
              ws.pinned
                ? 'fill-[var(--ws-star)] stroke-[var(--ws-star)]'
                : 'text-text-tertiary hover:text-text-secondary opacity-0 transition-opacity group-hover/row:opacity-100'
            )}
            strokeWidth={1.5}
            aria-label={ws.pinned ? 'Unpin' : 'Pin'}
          />
        )}
        <button
          type="button"
          title="Open window"
          aria-label="Open window"
          onClick={(e) => {
            e.stopPropagation();
            onLaunch(ws);
          }}
          className="text-text-secondary hover:text-text-primary flex size-6 cursor-pointer items-center justify-center rounded opacity-0 transition-opacity group-hover/row:opacity-100"
        >
          <FolderOpen className="size-3.5" strokeWidth={1.5} />
        </button>
        <span
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="opacity-0 transition-opacity group-hover/row:opacity-100"
        >
          <WorkspaceMenu
            ws={ws}
            onOpen={() => navigate(`/workspaces/${ws.id}`)}
            onLaunch={onLaunch}
            onReveal={onReveal}
            onLocate={onLocate}
            onPin={onPin}
            onRename={onRename}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        </span>
      </span>
    </div>
  );
});
