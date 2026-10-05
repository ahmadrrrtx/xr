/*
 * Phase 10 — delete dialog.
 *
 * Destructive, clearly labeled: the row always goes; files are trashed only
 * when the user ticks "Also move files to trash" (unchecked by default).
 * Folder-missing workspaces skip the checkbox (nothing to trash).
 */
import { useState } from 'react';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  name: string;
  path: string;
  pathExists: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (deleteFiles: boolean) => void;
}

export function DeleteDialog({
  open,
  name,
  path,
  pathExists,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  // Fresh mount per open (the screen renders the dialog conditionally, and
  // Radix unmounts content while closed) — initial state is always clean.
  const [deleteFiles, setDeleteFiles] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onCancel()}>
      <DialogContent
        className="border-border-subtle bg-bg-ink sm:max-w-sm"
        role="alertdialog"
      >
        <DialogHeader>
          <DialogTitle className="text-[15px]">Delete “{name}”?</DialogTitle>
          <DialogDescription className="text-[12px]">
            Removes the workspace from XR. The folder
            {pathExists
              ? ' and its files may be moved to the trash'
              : ' no longer exists'}
            :
            <span className="text-text-secondary mt-1.5 block truncate font-mono text-[11px]">
              {path}
            </span>
          </DialogDescription>
        </DialogHeader>

        {pathExists && (
          <label className="border-border-subtle flex cursor-pointer items-start gap-2.5 rounded-lg border p-3">
            <input
              data-testid="delete-files-checkbox"
              type="checkbox"
              checked={deleteFiles}
              onChange={(e) => setDeleteFiles(e.target.checked)}
              className="mt-0.5 size-4 cursor-pointer accent-[var(--danger)]"
            />
            <span className="text-[12px] leading-snug">
              <span className="font-medium">Also move files to trash</span>
              <span className="text-text-tertiary block">
                The folder is deleted with its contents. Unchecked leaves the
                folder on disk as-is.
              </span>
            </span>
          </label>
        )}

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => onConfirm(deleteFiles)}
          >
            <Trash2 className="size-4" strokeWidth={1.5} />
            {deleteFiles ? 'Delete + trash files' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
