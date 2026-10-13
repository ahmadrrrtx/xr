import { create } from 'zustand';
import { enqueue, dequeue, readQueue } from '../lib/idb';
import type { QueuedRequest } from '../types';

/**
 * The offline outbox. POSTs that matter (send a message, create a chat, approve
 * or deny) land here when the daemon is unreachable and are replayed FIFO once
 * it's reachable again — either by Background Sync in the service worker or by
 * the foreground `drain()` when the app is open.
 */
interface QueueState {
  items: QueuedRequest[];
  draining: boolean;
  refresh: () => Promise<void>;
  add: (item: QueuedRequest) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setDraining: (draining: boolean) => void;
}

export const useQueue = create<QueueState>((set) => ({
  items: [],
  draining: false,

  refresh: async () => {
    const items = await readQueue();
    set({ items });
  },

  add: async (item) => {
    const items = await enqueue(item);
    set({ items });
  },

  remove: async (id) => {
    const items = await dequeue(id);
    set({ items });
  },

  setDraining: (draining) => set({ draining }),
}));

export async function queueCount(): Promise<number> {
  return (await readQueue()).length;
}
