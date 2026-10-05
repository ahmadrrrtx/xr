/* Phase 10 — rename dialog (name only; the slug stays the URL key). */
import { useEffect, useRef, useState } from 'react';

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
  initialName: string;
  busy?: boolean;
  onCancel: () => void;
  onRename: (name: string) => void;
}

export function RenameDialog({
  open,
  initialName,
  busy,
  onCancel,
  onRename,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onCancel()}>
      <DialogContent className="border-border-subtle bg-bg-ink sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Rename workspace</DialogTitle>
          <DialogDescription className="text-[12px]">
            The folder on disk keeps its name — only the label changes.
          </DialogDescription>
        </DialogHeader>
        {/* State lives in this inner component: Radix unmounts the content
            while closed, so the draft resets naturally on every open. */}
        <RenameBody
          initialName={initialName}
          busy={busy}
          onCancel={onCancel}
          onRename={onRename}
        />
      </DialogContent>
    </Dialog>
  );
}

function RenameBody({
  initialName,
  busy,
  onCancel,
  onRename,
}: {
  initialName: string;
  busy?: boolean;
  onCancel: () => void;
  onRename: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // focus + select after Radix mounts the dialog
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const valid = name.trim().length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onRename(name.trim());
      }}
    >
      <input
        ref={inputRef}
        data-testid="rename-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Workspace name"
        className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border bg-transparent px-3 font-mono text-sm shadow-xs outline-none focus-visible:ring-[3px]"
      />
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
        <Button type="submit" size="sm" disabled={!valid || busy}>
          Rename
        </Button>
      </DialogFooter>
    </form>
  );
}
