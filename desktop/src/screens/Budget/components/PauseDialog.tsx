/*
 * "Pause all spending NOW" (Phase 13). Radix AlertDialog: focus lands on
 * Cancel, a required acknowledgement, and the confirm really pauses — the
 * governor denies every call until Resume, and in-flight runs are stopped.
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
import { Checkbox } from '@/components/ui/checkbox';
import { inProgress } from '@/runs/core';
import { useBudgetStore } from '@/stores/budgetStore';
import { useRunsStore } from '@/stores/runsStore';

export function PauseDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {open ? <PauseBody onDone={() => onOpenChange(false)} /> : null}
    </AlertDialog>
  );
}

function PauseBody({ onDone }: { onDone: () => void }) {
  const running = useRunsStore((s) => s.inProgressCount);
  const [ack, setAck] = useState(false);

  return (
    <AlertDialogContent data-testid="budget-pause-dialog">
      <AlertDialogHeader>
        <AlertDialogTitle>Pause all spending now?</AlertDialogTitle>
        <AlertDialogDescription>
          Every cloud and local call is blocked until you resume — chat,
          quick-ask and agent runs. {running} running{' '}
          {running === 1 ? 'run' : 'runs'} will be stopped. Nothing is deleted;
          History keeps every event.
        </AlertDialogDescription>
      </AlertDialogHeader>

      <label className="border-border-subtle bg-bg-raised/40 flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-[13px]">
        <Checkbox
          checked={ack}
          onCheckedChange={(v) => setAck(v === true)}
          data-testid="budget-pause-ack"
          aria-required="true"
          className="mt-0.5"
        />
        <span className="text-text-primary">
          I understand this interrupts active work
        </span>
      </label>

      <AlertDialogFooter>
        <AlertDialogCancel className="h-8 text-[13px]">
          Cancel
        </AlertDialogCancel>
        <AlertDialogAction
          data-testid="budget-pause-confirm"
          disabled={!ack}
          className="bg-danger h-8 text-[13px] text-white hover:opacity-90 disabled:opacity-40"
          onClick={(e) => {
            e.preventDefault();
            if (!ack) return;
            void (async () => {
              // Stop in-flight runs first, then flip the governor.
              const { useBrainStore } = await import('@/stores/brainStore');
              const rs = useRunsStore.getState();
              const live = Object.values(rs.runs).filter((r) =>
                inProgress(r.status)
              );
              for (const r of live) {
                useBrainStore.getState().stopRun(r.id, {
                  silent: true,
                  reason: 'Stopped — spending paused by user',
                });
              }
              if (live.length) {
                rs.applyCancelled(
                  live.map((r) => r.id),
                  { by: 'budget', reason: 'Stopped — spending paused by user' }
                );
              }
              await useBudgetStore.getState().pause('emergency');
            })();
            onDone();
          }}
        >
          Pause spending
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}
