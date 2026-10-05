/* Phase 10 — per-workspace ⋯ menu (Open/Reveal/Pin/Rename/Duplicate/Delete). */
import {
  Copy,
  FolderOpen,
  FolderSearch,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Rocket,
  Trash2,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Workspace } from '@/workspaces/types';

interface Props {
  ws: Workspace;
  onOpen: (ws: Workspace) => void;
  onLaunch: (ws: Workspace) => void;
  onReveal: (ws: Workspace) => void;
  onLocate: (ws: Workspace) => void;
  onPin: (ws: Workspace) => void;
  onRename: (ws: Workspace) => void;
  onDuplicate: (ws: Workspace) => void;
  onDelete: (ws: Workspace) => void;
}

export function WorkspaceMenu({
  ws,
  onOpen,
  onLaunch,
  onReveal,
  onLocate,
  onPin,
  onRename,
  onDuplicate,
  onDelete,
}: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`More actions for ${ws.name}`}
          data-testid="workspace-menu"
          className="hover:bg-bg-raised text-text-secondary hover:text-text-primary flex size-6 cursor-pointer items-center justify-center rounded transition-colors"
        >
          <MoreHorizontal className="size-3.5" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => onOpen(ws)}>
          <FolderOpen className="size-4" strokeWidth={1.5} />
          Open
          <span className="text-text-tertiary ml-auto font-mono text-[10px]">
            landing
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onLaunch(ws)}>
          <Rocket className="size-4" strokeWidth={1.5} />
          Open window
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!ws.pathExists}
          onClick={() => onReveal(ws)}
        >
          <FolderSearch className="size-4" strokeWidth={1.5} />
          Reveal in file manager
        </DropdownMenuItem>
        {!ws.pathExists && (
          <DropdownMenuItem onClick={() => onLocate(ws)}>
            <FolderSearch className="size-4" strokeWidth={1.5} />
            Locate folder…
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onPin(ws)}>
          {ws.pinned ? (
            <PinOff className="size-4" strokeWidth={1.5} />
          ) : (
            <Pin className="size-4" strokeWidth={1.5} />
          )}
          {ws.pinned ? 'Unpin' : 'Pin'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onRename(ws)}>
          <Pencil className="size-4" strokeWidth={1.5} />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onDuplicate(ws)}>
          <Copy className="size-4" strokeWidth={1.5} />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="text-danger focus:text-danger"
          onClick={() => onDelete(ws)}
        >
          <Trash2 className="size-4" strokeWidth={1.5} />
          Delete workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
