import { useQueue } from '../stores/queue';
import { useChats } from '../stores/chats';
import { useApprovals } from '../stores/approvals';
import { useConnection } from '../stores/connection';
import type { QueuedRequest } from '../types';

/**
 * Drain the outbox, FIFO, in order.
 *
 * Called from three places:
 *  - the app regaining connectivity (online event / successful probe),
 *  - the app coming to the foreground,
 *  - the service worker's Background Sync firing while the app is closed
 *    (it posts a 'xr-drain' message and we pick it up on next open).
 *
 * Sequential on purpose: chat messages must arrive in the order they were
 * written, and an approval decision should never overtake the message that
 * explains it.
 */
let draining = false;

export async function drain(): Promise<void> {
  if (draining) return;
  const queue = useQueue.getState();
  if (queue.items.length === 0) return;

  draining = true;
  queue.setDraining(true);
  try {
    // Ensure the daemon really is reachable before replaying anything.
    const status = await useConnection.getState().probe();
    if (status !== 'connected') return;

    const items = [...useQueue.getState().items].sort((a, b) => a.createdAt - b.createdAt);

    for (const item of items) {
      try {
        await replay(item);
        await useQueue.getState().remove(item.id);
      } catch {
        // Leave it in the queue; try again on the next reconnect.
        break;
      }
    }
    await useQueue.getState().refresh();
  } finally {
    draining = false;
    useQueue.getState().setDraining(false);
  }
}

async function replay(item: QueuedRequest): Promise<void> {
  const body = item.body as Record<string, unknown>;
  switch (item.kind) {
    case 'chat': {
      const chatId = String(body['chatId'] ?? '');
      const content = String(body['content'] ?? '');
      if (!chatId || !content) return;
      await useChats.getState().replay(chatId, content, item.localId ?? '');
      return;
    }
    case 'approval': {
      const decision = body['decision'] === 'deny' ? 'deny' : 'approve';
      await useApprovals.getState().replay(item.localId ?? '', decision);
      return;
    }
    case 'new-chat': {
      await useChats.getState().newChat();
      return;
    }
    default:
      // transcribe / anything else: drop. Voice notes are re-recorded, not
      // silently replayed days later.
      return;
  }
}
