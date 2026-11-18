import { expect, test } from 'bun:test';
import { RequestDeadlineExpired, withinDeadline } from '../../desktop/src/engine/deadline.ts';

test('a finite body that ignores cancellation is still bounded by the request deadline', async () => {
  await expect(withinDeadline(() => new Promise(() => {}), 10)).rejects.toBeInstanceOf(RequestDeadlineExpired);
});

test('a completed finite body cancels its timer and releases its signal', async () => {
  let observed: AbortSignal | undefined;
  expect(await withinDeadline(async (signal) => { observed = signal; return 'ok'; }, 10)).toBe('ok');
  expect(observed?.aborted).toBe(true); // finished; no stream was returned
});

test('an already cancelled caller starts no work and leaves no unhandled abort promise', async () => {
  const caller = new AbortController();
  const reason = new Error('cancelled before request');
  caller.abort(reason);
  let calls = 0;
  await expect(withinDeadline(async () => { calls++; }, 100, caller.signal)).rejects.toBe(reason);
  expect(calls).toBe(0);
  await Bun.sleep(0); // expose any detached rejected cancellation promise
});
