import { expect, test } from 'bun:test';
import { NODE_STARTUP_DEADLINE_MS, NODE_WORK_DEADLINE_MS, realNodeProbe } from './helpers/real-node-probe';

test('real Node security watchdog attests the runtime and does not substitute Bun', async () => {
  const result = await realNodeProbe({ work: 'assert(!process.versions.bun); console.log("real-node-control-passed");' });
  expect(result.timedOut, JSON.stringify(result)).toBe(false);
  expect(result.exitCode, JSON.stringify(result)).toBe(0);
  expect(result.runtime?.node).toMatch(/^\d+\./);
  expect(result.phase).toBe('complete');
  expect(result.stdout).toContain('real-node-control-passed');
  expect(NODE_STARTUP_DEADLINE_MS).toBe(1500);
  expect(NODE_WORK_DEADLINE_MS).toBe(500);
});

test('seeded startup hang is killed and cannot masquerade as a regex failure or pass', async () => {
  const result = await realNodeProbe({ bootstrap: 'while (true) {}', work: '', startupMs: 100 });
  expect(result.timedOut).toBe(true);
  expect(result.deadlinePhase).toBe('startup');
  expect(result.runtime).toBeUndefined();
  expect(result.exitCode).not.toBe(0);
});

test('seeded blocking security work is killed by the external work watchdog', async () => {
  const result = await realNodeProbe({ work: 'while (true) {}', workMs: 100 });
  expect(result.timedOut, JSON.stringify(result)).toBe(true);
  expect(result.deadlinePhase).toBe('work');
  expect(result.runtime?.node).toBeDefined();
  expect(result.exitCode).not.toBe(0);
  expect(result.events.some(event => event.kind === 'complete')).toBe(false);
});

test('real Node assertion failures remain failures with actionable diagnostics', async () => {
  const result = await realNodeProbe({ work: 'assert.fail("seeded-probe-refusal");' });
  expect(result.timedOut, JSON.stringify(result)).toBe(false);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain('seeded-probe-refusal');
  expect(result.phase).toBe('work');
});
