import '../helpers/dom-shim';
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
const scenario = process.argv[2];
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms));
const deferred = () => { let resolve!: (v: any) => void; return { promise: new Promise<any>(r => { resolve = r; }), resolve: (v: any) => resolve(v) }; };
const gate = deferred();
const { withinDeadline, ...deadline } = await import('../../../desktop/src/engine/deadline');
mock.module('../../../desktop/src/engine/deadline', () => ({ ...deadline, withinDeadline: (fn: any, ms: number, signal?: AbortSignal) => withinDeadline(fn, Math.min(ms, 35), signal) }));
mock.module('../../../desktop/src/lib/tauri', () => ({ isTauri: () => ['late-refresh-after-restart', 'restart-ipc-timeout', 'diagnostics-timeout'].includes(scenario) }));
mock.module('@tauri-apps/api/core', () => ({ invoke: async (command: string) => {
  if (scenario === 'restart-ipc-timeout' || scenario === 'diagnostics-timeout') return new Promise(() => {});
  return command === 'engine_restart' ? { ok: true } : [];
} }));
const transport = await import('../../../desktop/src/engine/transport');
const endpoint = { base: '/api/v1', token: null, via: 'dev-proxy', port: null, reason: null };
let healthCalls = 0, catalogs = 0;
let offline = false;
const snapshot = (name: string) => ({ primary: 'openai', model: name, providers: [{ id: 'openai', kind: 'cloud', hasKey: true, healthy: false }] });
mock.module('../../../desktop/src/engine/transport', () => ({ ...transport,
  resetEngineLink() {}, resetEngineHandshake() {},
  bootEngineLink: async () => { if (scenario === 'boot-deadline') await wait(20); return endpoint; },
  engineEndpoint: async () => endpoint,
  engineHandshake: async () => {
    if (scenario === 'boot-deadline') await wait(20);
    return { kind: 'ok', engineVersion: 'new-engine', contractVersion: 1, meta: { version: 'new-engine' } };
  },
  engineJson: async (path: string) => {
    if (path === '/health') {
      if (offline) throw new transport.EngineDown('unreachable');
      if (scenario === 'late-refresh-after-restart' && healthCalls++ === 0) return gate.promise;
      if (scenario === 'boot-deadline') await wait(20);
      return { ok: true, ts: 2 };
    }
    if (path === '/providers') {
      if (scenario === 'late-catalog' && catalogs++ === 0) return gate.promise;
      return snapshot('new-model');
    }
    if (path === '/providers/catalog') return { builtAt: 2, models: [] };
    return {};
  },
}));
const { useEngineStore: store, engineHasProvider, engineModelOptions } = await import('../../../desktop/src/stores/engineStore');
if (scenario === 'late-catalog') {
  store.setState({ status: 'ready' });
  const old = store.getState().loadCatalog({ force: true }); await wait();
  await store.getState().loadCatalog({ force: true }); gate.resolve(snapshot('old-model')); await old;
  assert.equal(store.getState().providers?.model, 'new-model');
  assert.ok(store.getState().catalogProvenance?.observedAt);
} else if (scenario === 'stale-on-loss') {
  await store.getState().refresh();
  assert.equal(engineHasProvider(), true);
  const good = store.getState().providers;
  const provenance = store.getState().catalogProvenance;
  offline = true; await store.getState().refresh();
  assert.equal(store.getState().providers, good); assert.deepEqual(store.getState().catalogProvenance, provenance);
  assert.equal(store.getState().catalogStale, true); assert.equal(engineHasProvider(), false);
  assert.ok(engineModelOptions().cloud.every(row => !row.available));
} else if (scenario === 'late-refresh-after-restart') {
  const old = store.getState().refresh(); await wait();
  const restarted = store.getState().startOrRestart(); await wait(5);
  gate.resolve({ ok: true, ts: 1 }); await old;
  assert.equal((await restarted).ok, true);
  assert.equal(store.getState().health?.ts, 2); assert.equal(store.getState().restarting, false);
} else if (scenario === 'boot-deadline') {
  const up = await store.getState().refresh(); assert.equal(up, false);
  assert.equal(store.getState().status, 'failed'); assert.equal(store.getState().failureReason, 'timeout');
  await wait(60); assert.notEqual(store.getState().status, 'ready');
} else if (scenario === 'restart-ipc-timeout') {
  const result = await Promise.race([store.getState().startOrRestart(), wait(120).then(() => null)]);
  assert.ok(result, 'native restart is bounded'); assert.equal(result.ok, false);
  assert.equal(store.getState().restarting, false); assert.equal(store.getState().failureReason, 'timeout');
} else {
  const { collectEngineDiagnostics } = await import('../../../desktop/src/engine/diagnostics');
  const result = await Promise.race([collectEngineDiagnostics(), wait(120).then(() => null)]);
  assert.ok(result, 'diagnostic IPC is bounded'); assert.match(result, /not-available-ipc-error/);
}
console.log(JSON.stringify({ scenario, ok: true }));
