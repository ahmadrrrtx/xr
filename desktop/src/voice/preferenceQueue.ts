/** A durable, single-flight outbox for USER INTENT, never a second settings authority.
 * Failed writes remain pending. An old acknowledgement cannot erase newer intent. */
export interface PendingPreference<T> { revision: string; patch: T }
export function createPreferenceQueue<T>(ports: {
  read(): Promise<PendingPreference<T> | null>;
  write(value: PendingPreference<T> | null): Promise<void>;
  apply(patch: T): Promise<unknown>;
}) {
  let mutations: Promise<unknown> = Promise.resolve();
  let inflight: Promise<void> | null = null;
  const serial = <R>(operation: () => Promise<R>): Promise<R> => {
    const task = mutations.then(operation);
    mutations = task.catch(() => {});
    return task;
  };
  return {
    enqueue: (patch: T): Promise<void> => serial(() => ports.write({ revision: crypto.randomUUID(), patch })),
    flush: (): Promise<void> => {
      if (inflight) return inflight;
      const task = (async () => {
        for (;;) {
          const pending = await serial(() => ports.read());
          if (!pending) return;
          await ports.apply(pending.patch); // rejection deliberately retains intent
          await serial(async () => {
            const current = await ports.read();
            if (current?.revision === pending.revision) await ports.write(null);
          });
        }
      })().finally(() => { if (inflight === task) inflight = null; });
      inflight = task;
      return task;
    },
  };
}
