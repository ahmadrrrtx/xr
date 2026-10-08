/*
 * Delete confirmation (Phase 19). Deleting removes the engine's JSON
 * document; sessions already bound to the agent keep their copy of the
 * prompt, so old chats stay readable.
 */
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
import { useAgentsStore } from '@/stores/agentsStore';

export function DeleteAgentDialog() {
  const id = useAgentsStore((s) => s.confirmDeleteId);
  const agent = useAgentsStore((s) => (s.confirmDeleteId ? s.agents.find((a) => a.id === s.confirmDeleteId) : undefined));
  return (
    <AlertDialog open={!!id} onOpenChange={(open) => !open && useAgentsStore.getState().requestDelete(null)}>
      <AlertDialogContent data-testid="delete-agent-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {agent?.label ?? 'this agent'}?</AlertDialogTitle>
          <AlertDialogDescription>
            The agent's JSON document is removed from the engine. Chats that used it keep their own copy of the prompt. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-danger text-white hover:bg-danger/90"
            onClick={() => {
              if (id) void useAgentsStore.getState().remove(id);
            }}
            data-testid="delete-agent-confirm"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
