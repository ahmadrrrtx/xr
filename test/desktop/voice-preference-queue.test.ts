import { expect, test } from 'bun:test';
import { createPreferenceQueue, type PendingPreference } from '../../desktop/src/voice/preferenceQueue.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

test('late acknowledgement does not clear a newer queued preference', async () => {
  let durable: PendingPreference<string> | null = null;
  const sent: string[] = [];
  const first = deferred();
  const started = deferred();
  const q = createPreferenceQueue({
    read: async () => durable,
    write: async (value: PendingPreference<string> | null) => { durable = value; },
    apply: async (patch: string) => { sent.push(patch); if (patch === 'old') { started.resolve(); await first.promise; } },
  });
  await q.enqueue('old');
  const a = q.flush();
  const b = q.flush();
  await started.promise;
  await q.enqueue('new');
  first.resolve();
  await Promise.all([a, b]);
  expect(sent).toEqual(['old', 'new']);
  expect(durable).toBeNull();
});

test('a failed engine write survives queue recreation (app restart)', async () => {
  let durable: PendingPreference<string> | null = null;
  const storage = { read: async () => durable,
    write: async (value: PendingPreference<string> | null) => { durable = value; } };
  const before = createPreferenceQueue({ ...storage, apply: async () => { throw new Error('offline'); } });
  await before.enqueue('chosen');
  await expect(before.flush()).rejects.toThrow('offline');
  expect(durable).not.toBeNull();
  const sent: string[] = [];
  const after = createPreferenceQueue({ ...storage, apply: async (patch: string) => { sent.push(patch); } });
  await after.flush();
  expect(sent).toEqual(['chosen']);
  expect(durable).toBeNull();
});
