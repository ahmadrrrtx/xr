/*
 * Emergency stop confirmation (Phase 11, brief §4.1). Radix AlertDialog:
 * role="alertdialog", Escape/Cancel closes, no outside-click dismiss.
 * Focus lands on Cancel; Enter on the field confirms. One component serves
 * both STOP ALL and a single row's stop.
 */
import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { useRunsStore, type RunsState } from '@/stores/runsStore';

export function StopDialog() {
  const dialog = useRunsStore((s) => s.stopDialog);
  const open = dialog !== null;
  // Keyed per request so the reason field remounts empty each time it opens.
  const key = dialog
    ? dialog.kind === 'all'
      ? 'all'
      : `one:${dialog.id}`
    : 'closed';

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) useRunsStore.getState().closeStopDialog();
      }}
    >
      {dialog ? <StopDialogBody key={key} dialog={dialog} /> : null}
    </AlertDialog>
  );
}

function StopDialogBody({
  dialog,
}: {
  dialog: NonNullable<RunsState['stopDialog']>;
}) {
  const inProgressCount = useRunsStore((s) => s.inProgressCount);
  const target = useRunsStore((s) =>
    dialog.kind === 'one' ? s.runs[dialog.id] : undefined
  );
  const [reason, setReason] = useState('');

  const isAll = dialog.kind === 'all';
  const n = isAll ? inProgressCount : 1;
  const trimmed = reason.trim() || undefined;

  const confirm = (): void => {
    const st = useRunsStore.getState();
    if (dialog.kind === 'all') void st.killAll(trimmed);
    else void st.kill(dialog.id, trimmed);
  };

  return (
    <AlertDialogContent data-testid="stop-dialog">
      <AlertDialogHeader>
        <AlertDialogTitle>
          {isAll
            ? 'Stop all running agents?'
            : `Stop run ${target?.shortId ?? ''}?`}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {isAll
            ? `${n} ${n === 1 ? 'run' : 'runs'} in progress will be stopped. Completed work is kept; no new work will start.`
            : `${target?.title ?? 'This run'} will be stopped where it is. Completed spans are kept.`}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <label className="flex flex-col gap-1.5">
        <span className="text-text-tertiary text-[11px] font-medium tracking-wide uppercase">
          Reason (optional)
        </span>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Logged with the stop"
          maxLength={120}
          className="h-8 text-[13px]"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              confirm();
            }
          }}
        />
      </label>

      <AlertDialogFooter>
        <AlertDialogCancel className="h-8 text-[13px]">
          Cancel
        </AlertDialogCancel>
        <AlertDialogAction
          data-testid="stop-confirm"
          className="h-8 text-[13px]"
          onClick={(e) => {
            e.preventDefault();
            confirm();
          }}
        >
          {isAll ? `Stop ${n} ${n === 1 ? 'agent' : 'agents'}` : 'Stop run'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}
