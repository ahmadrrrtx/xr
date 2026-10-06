/*
 * TopBar (Phase 17) — 44px: breadcrumb, git chip, preview target, sync dot,
 * Save / Push / Deploy. Push and Deploy are honest stubs (toast), never dead.
 */
import { GitBranch, Rocket, Save, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { basenameOf } from '@/lib/builderCore';
import { cn } from '@/lib/utils';
import { selectDirtyCount, useBuilderStore } from '@/stores/builderStore';
import type { Workspace } from '@/workspaces/types';

export function TopBar({ workspace }: { workspace: Workspace | null }) {
  const active = useBuilderStore((s) => s.active);
  const git = useBuilderStore((s) => s.git);
  const sync = useBuilderStore((s) => s.sync);
  const dirtyCount = useBuilderStore(selectDirtyCount);
  const project = useBuilderStore((s) => s.project);

  const syncLabel = sync === 'saving' ? 'Saving…' : sync === 'unsaved' ? 'Unsaved' : sync === 'error' ? 'Save failed' : 'Saved';
  const syncDot = sync === 'saving' ? 'is-accent' : sync === 'unsaved' ? 'is-warn' : sync === 'error' ? 'is-danger' : 'is-ok';

  return (
    <header className="xb-top" data-testid="builder-topbar">
      <nav className="xb-crumbs" aria-label="Breadcrumb">
        <Link to="/workspaces">Workspaces</Link>
        <span aria-hidden="true">›</span>
        {workspace ? <Link to={`/workspaces/${workspace.id}`}>{workspace.name}</Link> : <span>…</span>}
        {active ? (
          <>
            <span aria-hidden="true">›</span>
            <span className="is-file" title={active}>
              {basenameOf(active)}
            </span>
          </>
        ) : null}
      </nav>
      {project ? (
        git?.isRepo ? (
          <span className="xb-chip" title={git.dirty ? 'Uncommitted changes' : 'Working tree clean'} data-testid="builder-git-chip">
            <GitBranch size={11} />
            {git.branch ?? 'detached'}
            {git.dirty ? <span className="xb-dot is-warn" aria-label="modified" /> : <span className="text-success">✓</span>}
          </span>
        ) : (
          <span className="xb-chip" title="Not a git repository">
            <GitBranch size={11} /> no git
          </span>
        )
      ) : null}
      <span className="xb-top-spacer" />
      <Select value="dev">
        <SelectTrigger aria-label="Preview target" className="border-border-subtle bg-bg-ink h-7! w-[132px] text-[12px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="dev" className="text-[12.5px]">
            Dev server
          </SelectItem>
          <SelectItem value="static" disabled className="text-[12.5px]">
            Static build · planned
          </SelectItem>
        </SelectContent>
      </Select>
      <span className="xb-sync" role="status" aria-live="polite" data-testid="builder-sync">
        <span className={cn('xb-dot', syncDot)} aria-hidden="true" />
        {syncLabel}
        {dirtyCount > 1 ? ` · ${dirtyCount}` : ''}
      </span>
      <button type="button" className="xb-ghost" onClick={() => void useBuilderStore.getState().saveFile()} disabled={!active} aria-keyshortcuts="Meta+S Control+S" title="Save (⌘S)">
        <Save size={12} /> Save
      </button>
      <button type="button" className="xb-ghost" onClick={() => toast('Git push coming later', { description: 'Commit and push from your terminal for now.' })} title="Push">
        <Upload size={12} /> Push
      </button>
      <button type="button" className="xb-primary" onClick={() => toast('Deploy coming in a future update')} title="Deploy">
        <Rocket size={12} /> Deploy
      </button>
    </header>
  );
}
