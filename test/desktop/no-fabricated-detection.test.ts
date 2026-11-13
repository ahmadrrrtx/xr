/*
 * XR-REL-01 — no fabricated hardware, ever.
 *
 * Regression pin for the release blocker where `lib/detect.ts` answered every
 * failed probe with a hardcoded "Apple M3 Pro / 36 GB" machine and an
 * installed Ollama, and the production bundle shipped those strings. The
 * wizard then offered a 4.7 GB model download tuned to hardware the user did
 * not have.
 *
 * These assertions are source-level on purpose: the failure mode was a
 * *shipped constant*, so a bundle/source grep is the honest gate (the runtime
 * behaviour is covered by a separate test below).
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DESKTOP_SRC = resolve(import.meta.dir, '..', '..', 'desktop', 'src');

function read(path: string): string {
  return readFileSync(join(DESKTOP_SRC, path), 'utf8');
}

/** Walk desktop/src, skipping tests. */
function sourceFiles(dir = DESKTOP_SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    if (/\.test\.(ts|tsx)$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

describe('XR-REL-01 · detection never invents hardware', () => {
  test('detect.ts carries no hardcoded hardware profile', () => {
    const src = read('lib/detect.ts');
    for (const forbidden of [
      'Apple M3 Pro',
      '(browser dev)',
      '(mock)',
      'totalMemoryGb: 36',
    ]) {
      expect(src.includes(forbidden)).toBe(false);
    }
  });

  test('detect.ts has no silent catch-to-mock fallback', () => {
    const src = read('lib/detect.ts');
    // The old failure mode: `catch { /* fall through to mock */ }` inside a
    // detector, which swallowed IPC/ACL denials and returned fake data.
    expect(/fall through to mock/i.test(src)).toBe(false);
  });

  test('recommendModel refuses an unmeasured RAM value', () => {
    const src = read('lib/detect.ts');
    // Guard must exist before the first tier branch.
    const guardIndex = src.indexOf('requires a measured RAM value');
    const firstTier = src.indexOf("'qwen2.5:0.5b'");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(firstTier);
  });

  test('no other desktop source file hardcodes a machine profile', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const src = readFileSync(file, 'utf8');
      if (/Apple M\d/i.test(src) && !file.endsWith('detect.ts')) {
        offenders.push(file.replace(DESKTOP_SRC, ''));
      }
    }
    expect(offenders).toEqual([]);
  });

  test('detectSystem/detectOllama reject instead of resolving a fake value', async () => {
    // Outside the native shell there is no detection — the module must say so.
    const { detectSystem, detectOllama, DetectionUnavailable } = await import(
      '../../desktop/src/lib/detect'
    );
    await expect(detectSystem()).rejects.toBeInstanceOf(DetectionUnavailable);
    await expect(detectOllama()).rejects.toBeInstanceOf(DetectionUnavailable);

    const failure = await (async () => {
      try {
        await detectSystem();
        return null;
      } catch (error) {
        return error as InstanceType<typeof DetectionUnavailable>;
      }
    })();
    expect(failure?.probe).toBe('system');
    // The operator-facing message must not read like a hardware fact.
    expect(failure?.message ?? '').not.toMatch(/Apple|GB/i);
  });
});
