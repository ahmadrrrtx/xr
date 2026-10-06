/*
 * FileTree (Phase 17) — the 240px explorer. Keyboard-navigable tree rows,
 * ext-coloured glyph icons, git badges (M/U/A/D), inline new/rename inputs,
 * and a context menu whose destructive item confirms. Single-click previews
 * (italic tab), double-click pins.
 */
import { FilePlus, FolderPlus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { workspaceDb } from '@/lib/workspace-db';
import { buildTree, dirnameOf, fileIconFor, flattenTree, type TreeNode } from '@/lib/builderCore';
import type { GitBadge } from '@/engine/builder';
import { useBuilderStore } from '@/stores/builderStore';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const BADGE: Record<GitBadge, { glyph: string; cls: string; label: string }> = {
  modified: { glyph: 'M', cls: 'xb-badge-m', label: 'Modified' },
  staged: { glyph: 'M', cls: 'xb-badge-m', label: 'Staged' },
  untracked: { glyph: 'U', cls: 'xb-badge-u', label: 'Untracked' },
  added: { glyph: 'A', cls: 'xb-badge-a', label: 'Added' },
  deleted: { glyph: 'D', cls: 'xb-badge-d', label: 'Deleted' },
  renamed: { glyph: 'R', cls: 'xb-badge-m', label: 'Renamed' },
};

interface Draft {
  kind: 'file' | 'folder' | 'rename';
  parent: string;
  target?: string;
  initial: string;
}

export function FileTree({ onOpenTerminal }: { onOpenTerminal: (cwd: string) => void }) {
  const entries = useBuilderStore((s) => s.tree);
  const loading = useBuilderStore((s) => s.treeLoading);
  const truncated = useBuilderStore((s) => s.treeTruncated);
  const expanded = useBuilderStore((s) => s.expanded);
  const git = useBuilderStore((s) => s.git);
  const active = useBuilderStore((s) => s.active);
  const buffers = useBuilderStore((s) => s.buffers);
  const project = useBuilderStore((s) => s.project);
  const [focusedState, setFocused] = useState<string | null>(null);
  const focused = focusedState ?? active;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TreeNode | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const nodes = useMemo(() => buildTree(entries), [entries]);
  const rows = useMemo(() => flattenTree(nodes, expanded), [nodes, expanded]);
  const folderBadges = useMemo(() => {
    const out = new Set<string>();
    if (!git) return out;
    for (const p of Object.keys(git.files)) {
      let d = dirnameOf(p);
      while (d) {
        out.add(d);
        d = dirnameOf(d);
      }
    }
    return out;
  }, [git]);

  const st = useBuilderStore.getState;

  const activate = useCallback(
    (node: TreeNode, pin: boolean) => {
      if (node.type === 'dir') st().toggleExpanded(node.rel);
      else void st().openFile(node.rel, { pin });
    },
    [st],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!rows.length) return;
    const idx = Math.max(0, rows.findIndex((r) => r.rel === focused));
    const cur = rows[idx];
    const go = (n: number) => {
      const next = rows[Math.min(rows.length - 1, Math.max(0, n))];
      if (next) {
        setFocused(next.rel);
        listRef.current?.querySelector<HTMLElement>(`[data-rel="${CSS.escape(next.rel)}"]`)?.scrollIntoView({ block: 'nearest' });
      }
    };
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        go(idx + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        go(idx - 1);
        break;
      case 'ArrowRight':
        if (cur?.type === 'dir' && !expanded.has(cur.rel)) {
          e.preventDefault();
          st().toggleExpanded(cur.rel);
        }
        break;
      case 'ArrowLeft':
        if (cur?.type === 'dir' && expanded.has(cur.rel)) {
          e.preventDefault();
          st().toggleExpanded(cur.rel);
        } else if (cur) {
          const parent = dirnameOf(cur.rel);
          if (parent) {
            e.preventDefault();
            setFocused(parent);
          }
        }
        break;
      case 'Enter':
        if (cur) {
          e.preventDefault();
          activate(cur, true);
        }
        break;
      case ' ':
        if (cur) {
          e.preventDefault();
          activate(cur, false);
        }
        break;
      case 'F2':
        if (cur) {
          e.preventDefault();
          setDraft({ kind: 'rename', parent: dirnameOf(cur.rel), target: cur.rel, initial: cur.name });
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (cur && (e.metaKey || e.ctrlKey || e.key === 'Delete')) {
          e.preventDefault();
          setConfirmDelete(cur);
        }
        break;
      default:
        break;
    }
  };

  const startDraft = (kind: 'file' | 'folder', near: TreeNode | null) => {
    const parent = near ? (near.type === 'dir' ? near.rel : dirnameOf(near.rel)) : '';
    if (parent) st().revealPath(`${parent}/x`);
    setDraft({ kind, parent, initial: '' });
  };

  const commitDraft = async (value: string) => {
    const d = draft;
    setDraft(null);
    const name = value.trim();
    if (!d || !name) return;
    if (name.includes('/') || name === '.' || name === '..') {
      toast('Use a simple name', { description: 'Create nested folders one level at a time.' });
      return;
    }
    if (d.kind === 'rename' && d.target) {
      if (name === d.initial) return;
      const to = d.parent ? `${d.parent}/${name}` : name;
      await st().renamePath(d.target, to);
      setFocused(to);
      return;
    }
    const path = d.parent ? `${d.parent}/${name}` : name;
    const ok = await st().createPath(path, d.kind === 'folder' ? 'folder' : 'file');
    if (ok) setFocused(path);
  };

  const reveal = async (node: TreeNode) => {
    if (!project) return;
    const abs = `${project.root}/${node.type === 'dir' ? node.rel : dirnameOf(node.rel)}`.replace(/\/$/, '');
    const ok = await workspaceDb.revealInFinder(abs);
    if (!ok) toast('Could not reveal folder', { description: 'Available in the desktop app.' });
  };

  return (
    <div className="xb-tree" data-testid="builder-tree">
      <div className="xb-tree-head">
        <span className="xb-pane-title">Files</span>
        <div className="xb-tree-actions">
          <button type="button" className="xb-icon-btn" aria-label="New file" title="New file" onClick={() => startDraft('file', rows.find((r) => r.rel === focused) ?? null)}>
            <FilePlus size={13} />
          </button>
          <button type="button" className="xb-icon-btn" aria-label="New folder" title="New folder" onClick={() => startDraft('folder', rows.find((r) => r.rel === focused) ?? null)}>
            <FolderPlus size={13} />
          </button>
          <button type="button" className="xb-icon-btn" aria-label="Refresh tree" title="Refresh" onClick={() => void st().refreshTree()}>
            <RefreshCw size={12} className={cn(loading && 'animate-spin')} />
          </button>
        </div>
      </div>
      <div ref={listRef} role="tree" aria-label="Project files" tabIndex={0} className="xb-tree-list" onKeyDown={onKeyDown}>
        {loading && rows.length === 0 ? (
          <div className="xb-tree-skeleton" aria-hidden="true">
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} className="xb-skel" style={{ width: `${55 + ((i * 37) % 40)}%`, marginLeft: (i % 3) * 12 }} />
            ))}
          </div>
        ) : null}
        {!loading && rows.length === 0 ? <p className="xb-tree-empty">Empty folder. Create a file to begin.</p> : null}
        {draft && draft.parent === '' && draft.kind !== 'rename' ? <DraftRow depth={0} draft={draft} onCommit={commitDraft} onCancel={() => setDraft(null)} /> : null}
        {rows.map((node) => {
          const isOpen = expanded.has(node.rel);
          const badge = git?.files[node.rel];
          const dirDirty = node.type === 'dir' && folderBadges.has(node.rel);
          const dirty = node.type === 'file' && buffers[node.rel]?.dirty;
          const isActive = node.rel === active;
          const icon = fileIconFor(node.rel, node.type === 'dir');
          const renaming = draft?.kind === 'rename' && draft.target === node.rel;
          return (
            <div key={node.rel}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div
                    role="treeitem"
                    data-rel={node.rel}
                    aria-level={node.depth + 1}
                    aria-selected={isActive}
                    {...(node.type === 'dir' ? { 'aria-expanded': isOpen } : {})}
                    className={cn('xb-row', isActive && 'is-active', focused === node.rel && 'is-focused', badge && `has-${badge}`, node.heavy && 'is-heavy')}
                    style={{ paddingLeft: 8 + node.depth * 14 }}
                    onClick={() => {
                      setFocused(node.rel);
                      activate(node, false);
                    }}
                    onDoubleClick={() => node.type === 'file' && st().pinTab(node.rel)}
                    onContextMenu={() => setFocused(node.rel)}
                    title={node.rel}
                  >
                    {node.type === 'dir' ? (
                      <span className={cn('xb-chev', isOpen && 'is-open')} aria-hidden="true">
                        ▸
                      </span>
                    ) : (
                      <span className="xb-glyph" style={{ color: icon.color }} aria-hidden="true">
                        {icon.glyph}
                      </span>
                    )}
                    {renaming ? (
                      <InlineInput initial={draft.initial} onCommit={commitDraft} onCancel={() => setDraft(null)} />
                    ) : (
                      <span className={cn('xb-row-name', dirty && 'is-dirty')}>{node.name}</span>
                    )}
                    {badge ? (
                      <span className={cn('xb-badge', BADGE[badge].cls)} aria-label={BADGE[badge].label} title={BADGE[badge].label}>
                        {BADGE[badge].glyph}
                      </span>
                    ) : dirDirty ? (
                      <span className="xb-badge-dot" aria-label="Contains changes" />
                    ) : null}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-[180px] text-[12.5px]">
                  <ContextMenuItem onSelect={() => startDraft('file', node)}>New file</ContextMenuItem>
                  <ContextMenuItem onSelect={() => startDraft('folder', node)}>New folder</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => setDraft({ kind: 'rename', parent: dirnameOf(node.rel), target: node.rel, initial: node.name })}>Rename</ContextMenuItem>
                  <ContextMenuItem className="text-danger" onSelect={() => setConfirmDelete(node)}>
                    Delete…
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => void reveal(node)}>Reveal in Finder</ContextMenuItem>
                  <ContextMenuItem onSelect={() => onOpenTerminal(node.type === 'dir' ? node.rel : dirnameOf(node.rel))}>Open in terminal</ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => {
                      void navigator.clipboard?.writeText(node.rel);
                      toast('Path copied');
                    }}
                  >
                    Copy relative path
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {draft && draft.kind !== 'rename' && node.type === 'dir' && draft.parent === node.rel && isOpen ? (
                <DraftRow depth={node.depth + 1} draft={draft} onCommit={commitDraft} onCancel={() => setDraft(null)} />
              ) : null}
            </div>
          );
        })}
        {truncated ? <p className="xb-tree-empty">Showing the first 5,000 entries.</p> : null}
      </div>

      <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.type === 'dir' ? 'folder' : 'file'}?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono text-[12px]">{confirmDelete?.rel}</span>
              {confirmDelete?.type === 'dir' ? ' and everything inside it will be removed from disk.' : ' will be removed from disk.'} This cannot be undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-danger text-white hover:bg-danger/90"
              onClick={() => {
                const n = confirmDelete;
                setConfirmDelete(null);
                if (n) void st().deletePath(n.rel);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DraftRow({ depth, draft, onCommit, onCancel }: { depth: number; draft: Draft; onCommit: (v: string) => void; onCancel: () => void }) {
  return (
    <div className="xb-row is-draft" style={{ paddingLeft: 8 + depth * 14 }}>
      <span className="xb-glyph" aria-hidden="true">
        {draft.kind === 'folder' ? '▸' : '·'}
      </span>
      <InlineInput initial="" placeholder={draft.kind === 'folder' ? 'folder name' : 'file name'} onCommit={onCommit} onCancel={onCancel} />
    </div>
  );
}

function InlineInput({ initial, placeholder, onCommit, onCancel }: { initial: string; placeholder?: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  return (
    <input
      ref={ref}
      defaultValue={initial}
      placeholder={placeholder}
      aria-label={placeholder ?? 'Name'}
      className="xb-inline-input"
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') onCommit(e.currentTarget.value);
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={(e) => (e.currentTarget.value.trim() && e.currentTarget.value !== initial ? onCommit(e.currentTarget.value) : onCancel())}
    />
  );
}
