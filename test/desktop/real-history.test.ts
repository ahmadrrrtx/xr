import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { realRecentRuns } from "../../desktop/src/brain/recent.ts";
import type { Run } from "../../desktop/src/brain/types.ts";
import { APP_VERSION } from "../../desktop/src/lib/appMeta.ts";
import manifest from "../../release.manifest.json";

const run = (id: string, source?: 'engine'): Run => ({
  id, shortId: '#1', title: id, agent: 'main', model: 'test', status: 'completed',
  startedAt: 100, endedAt: 200, tokensIn: 1, tokensOut: 1, costUsd: 0, rootSpanId: 'root', source,
});

test("recent history never seeds examples or mixes demo traces into real runs", () => {
  expect(realRecentRuns([], {}, 1000)).toEqual([]);
  const entries = { demo: run('demo'), real: run('real', 'engine'), real2: run('real2', 'engine') };
  const rows = realRecentRuns(['demo', 'real', 'real2', 'real'], entries, 1000);
  expect(rows.map(r => r.id)).toEqual(['real', 'real2']);
  expect(rows[0]?.durationMs).toBe(100);
});

test("tool trace never manufactures a demo when the real run id is missing", () => {
  const text = readFileSync(resolve(import.meta.dir, '../../desktop/src/screens/Chat/components/ToolCallCard.tsx'), 'utf8');
  expect(text).not.toContain('startMockRun(');
  expect(text).toContain('disabled={!runId}');
  expect(text).toContain('Trace unavailable');
});

test("desktop diagnostics use the stamped release version", () => {
  expect(APP_VERSION).toBe(manifest.identity.version);
});
