/*
 * Phase 10 — New Workspace modal (⌘N / "+ New Workspace").
 *
 * Template picker (6) · name · folder (defaults to ~/xr/workspaces/<slug>) ·
 * git template adds a URL field. Clone shows inline progress + error with
 * retry — no full-screen takeover.
 */
import { useMemo, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { WORKSPACE_TEMPLATES } from '@/workspaces/templates';
import { WORKSPACE_KIND_META, type WorkspaceKind } from '@/workspaces/types';

interface Props {
  open: boolean;
  /** Template preselected by a strip click (null = user picks). */
  initialTemplate?: string | null;
  /** True while creating a scaffold (fast) — spinner on the button. */
  creating: boolean;
  /** True while a git clone is streaming progress. */
  cloning: boolean;
  progress: { percent: number; stage: string } | null;
  /** Last clone/create failure (from the store) — inline error + Retry. */
  error: string | null;
  onClose: () => void;
  onCreate: (name: string, templateId: string, folder: string | null) => void;
  onClone: (url: string, name: string | null) => void;
}

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base === '' ? '' : base;
}

export function NewWorkspaceModal(props: Props) {
  const { open, creating, cloning, onClose } = props;
  const busy = creating || cloning;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="border-border-subtle bg-bg-ink sm:max-w-lg">
        {/* State lives in the inner body: Radix unmounts the content while
            closed, so every open starts from a blank draft. */}
        <ModalBody {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ModalBody({
  initialTemplate,
  creating,
  cloning,
  progress,
  error,
  onClose,
  onCreate,
  onClone,
}: Props) {
  const [templateId, setTemplateId] = useState<string | null>(
    initialTemplate ?? null
  );
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [folderTouched, setFolderTouched] = useState(false);
  const [url, setUrl] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const busy = creating || cloning;

  const slug = useMemo(() => slugify(name), [name]);
  const isGit = templateId === 'git';
  const defaultFolder = useMemo(
    () => (slug ? `~/xr/workspaces/${slug}` : '~/xr/workspaces/…'),
    [slug]
  );
  const folderValue = folderTouched ? folder : defaultFolder;

  const ready = isGit ? url.trim().length > 0 : name.trim().length > 0;

  const submit = (): void => {
    setValidationError(null);
    if (!templateId) {
      setValidationError('Pick a template first.');
      return;
    }
    if (isGit) {
      onClone(url, name.trim() || null);
    } else {
      onCreate(name, templateId, folderTouched ? folder.trim() : null);
    }
  };

  const TemplateRow = ({ id }: { id: string }): React.JSX.Element => {
    const t = WORKSPACE_TEMPLATES.find((x) => x.id === id)!;
    const meta = WORKSPACE_KIND_META[t.kind as WorkspaceKind];
    const gv = meta.gradientVar;
    const active = templateId === id;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={active}
        data-testid={`new-template-${id}`}
        onClick={() => setTemplateId(id)}
        disabled={busy}
        className={cn(
          'flex w-full cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-left transition-all duration-150',
          active
            ? 'border-accent bg-[color-mix(in_oklab,var(--accent)_7%,transparent)]'
            : 'border-border-subtle hover:border-border-default hover:bg-bg-raised/40',
          busy && 'cursor-not-allowed opacity-60'
        )}
      >
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-[16px]"
          style={{
            background: `linear-gradient(135deg, color-mix(in oklab, var(--ws-${gv}-from) 20%, transparent), color-mix(in oklab, var(--ws-${gv}-to) 28%, transparent))`,
          }}
        >
          {t.emoji}
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] leading-tight font-medium">
            {t.label}
          </span>
          <span className="text-text-tertiary block truncate text-[11px]">
            {t.blurb}
          </span>
        </span>
      </button>
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-[15px]">New workspace</DialogTitle>
        <DialogDescription className="text-[12px]">
          Pick a template — files are written to a real folder. No installs run
          in the background.
        </DialogDescription>
      </DialogHeader>

      <div
        role="radiogroup"
        aria-label="Template"
        className="grid grid-cols-2 gap-2"
      >
        {WORKSPACE_TEMPLATES.map((t) => (
          <TemplateRow key={t.id} id={t.id} />
        ))}
      </div>

      {isGit ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-text-secondary text-[11.5px] font-medium">
              Repository URL
            </span>
            <input
              data-testid="modal-git-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              disabled={busy}
              className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border bg-transparent px-3 font-mono text-[12.5px] outline-none focus-visible:ring-[3px]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-text-secondary text-[11.5px] font-medium">
              Name <span className="text-text-tertiary">(optional)</span>
            </span>
            <input
              data-testid="modal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={url.split('/').pop() || 'derived from the URL'}
              disabled={busy}
              className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border bg-transparent px-3 text-[13px] outline-none focus-visible:ring-[3px]"
            />
          </label>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-text-secondary text-[11.5px] font-medium">
              Name
            </span>
            <input
              data-testid="modal-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My project"
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ready) submit();
              }}
              className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border bg-transparent px-3 text-[13px] outline-none focus-visible:ring-[3px]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-text-secondary text-[11.5px] font-medium">
              Folder{' '}
              <span className="text-text-tertiary">
                (defaults to ~/xr/workspaces)
              </span>
            </span>
            <input
              data-testid="modal-folder"
              value={folderValue}
              onChange={(e) => {
                setFolderTouched(true);
                setFolder(e.target.value);
              }}
              disabled={busy}
              className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border bg-transparent px-3 font-mono text-[12px] outline-none focus-visible:ring-[3px]"
            />
          </label>
        </div>
      )}

      {busy && progress && (
        <div
          data-testid="clone-progress"
          role="status"
          className="border-border-subtle bg-bg-raised/30 flex flex-col gap-1.5 rounded-lg border p-3"
        >
          <div className="flex items-center justify-between text-[12px]">
            <span className="flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" strokeWidth={1.5} />
              {progress.stage === 'error' ? 'Clone failed' : progress.stage}
            </span>
            <span className="text-text-tertiary font-mono text-[11px]">
              {progress.percent}%
            </span>
          </div>
          <div className="bg-bg-raised h-1 overflow-hidden rounded-full">
            <div
              className="bg-accent h-full rounded-full transition-[width] duration-200"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      )}

      {(error ?? validationError) && !busy && (
        <div
          data-testid="clone-error"
          role="alert"
          className="flex items-center justify-between gap-2 rounded-lg border border-[color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[color-mix(in_oklab,var(--danger)_8%,transparent)] px-3 py-2 text-[12px]"
        >
          <span className="min-w-0 truncate">{error ?? validationError}</span>
          <button
            type="button"
            onClick={submit}
            className="flex shrink-0 cursor-pointer items-center gap-1 text-[11.5px] font-medium underline-offset-2 hover:underline"
          >
            <RotateCcw className="size-3" strokeWidth={1.5} />
            Retry
          </button>
        </div>
      )}

      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="button"
          data-testid="modal-create-btn"
          disabled={!ready || busy}
          onClick={submit}
        >
          {busy
            ? isGit
              ? 'Cloning…'
              : 'Creating…'
            : isGit
              ? 'Clone repository'
              : 'Create workspace'}
        </Button>
      </DialogFooter>
    </>
  );
}
