/*
 * Resume confirmation reachable from any route (the banner's Resume). The
 * Shield screen renders its own copy of the same dialog; this host stays
 * silent while /shield is mounted so the two never double up.
 */
import { useLocation } from 'react-router-dom';

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
import { useShieldStore } from '@/stores/shieldStore';

export function ResumeDialogHost() {
  const open = useShieldStore((s) => s.resumeDialogOpen);
  const { pathname } = useLocation();
  if (pathname.startsWith('/shield')) return null;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) useShieldStore.getState().closeResumeDialog();
      }}
    >
      <AlertDialogContent data-testid="resume-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Resume agents?</AlertDialogTitle>
          <AlertDialogDescription>
            New requests will prompt again under your normal policy. Nothing
            that was denied or stopped is retried — agents must ask again.
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
    </AlertDialog>
  );
}
