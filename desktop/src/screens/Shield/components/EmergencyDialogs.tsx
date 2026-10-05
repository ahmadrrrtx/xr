/*
 * Emergency revoke + resume confirmations (Phase 12, SCREEN-BRIEFS §8).
 * Radix AlertDialog: role="alertdialog", focus lands on Cancel, backdrop
 * click does not dismiss. Revoke needs the acknowledgement checkbox before
 * "Pause everything" enables — the button does what it says (store.revokeAll
 * denies the queue, stops runs, flips the gate).
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
import { useApprovalStore } from '@/stores/approvalStore';
import { useRunsStore } from '@/stores/runsStore';
import { useShieldStore } from '@/stores/shieldStore';

export function EmergencyDialogs() {
  const revokeOpen = useShieldStore((s) => s.revokeDialogOpen);
  const resumeOpen = useShieldStore((s) => s.resumeDialogOpen);
  return (
    <>
      <AlertDialog
        open={revokeOpen}
        onOpenChange={(o) => {
          if (!o) useShieldStore.getState().closeRevokeDialog();
        }}
      >
        {revokeOpen ? <RevokeBody /> : null}
      </AlertDialog>
      <AlertDialog
        open={resumeOpen}
        onOpenChange={(o) => {
          if (!o) useShieldStore.getState().closeResumeDialog();
        }}
      >
        {resumeOpen ? <ResumeBody /> : null}
      </AlertDialog>
    </>
  );
}

function RevokeBody() {
  const pending = useApprovalStore((s) => s.pending.length);
  const running = useRunsStore((s) => s.inProgressCount);
  const [ack, setAck] = useState(false);

  return (
    <AlertDialogContent data-testid="revoke-dialog">
      <AlertDialogHeader>
        <AlertDialogTitle>
          Revoke all approvals and pause agents?
        </AlertDialogTitle>
        <AlertDialogDescription>
          {pending} pending {pending === 1 ? 'approval' : 'approvals'} will be
          denied and {running} running {running === 1 ? 'agent' : 'agents'}{' '}
          stopped. New requests are blocked until you resume. Completed work is
          kept.
        </AlertDialogDescription>
      </AlertDialogHeader>

      <label className="border-border-subtle bg-bg-raised/40 flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-[13px]">
        <Checkbox
          checked={ack}
          onCheckedChange={(v) => setAck(v === true)}
          data-testid="revoke-ack"
          aria-required="true"
          className="mt-0.5"
        />
        <span className="text-text-primary">
          I understand this will interrupt my active work
        </span>
      </label>

      <AlertDialogFooter>
        <AlertDialogCancel className="h-8 text-[13px]">
          Cancel
        </AlertDialogCancel>
        <AlertDialogAction
          data-testid="revoke-confirm"
          disabled={!ack}
          className="bg-danger h-8 text-[13px] text-white hover:opacity-90 disabled:opacity-40"
          onClick={(e) => {
            e.preventDefault();
            if (!ack) return;
            void useShieldStore.getState().revokeAll();
          }}
        >
          Pause everything
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

function ResumeBody() {
  return (
    <AlertDialogContent data-testid="resume-dialog">
      <AlertDialogHeader>
        <AlertDialogTitle>Resume agents?</AlertDialogTitle>
        <AlertDialogDescription>
          New requests will prompt again under your normal policy. Nothing that
          was denied or stopped is retried — agents must ask again.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel className="h-8 text-[13px]">
          Cancel
        </AlertDialogCancel>
        <AlertDialogAction
          data-testid="resume-confirm"
          className="h-8 text-[13px]"
          onClick={(e) => {
            e.preventDefault();
            void useShieldStore.getState().resume();
          }}
        >
          Resume agents
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}
