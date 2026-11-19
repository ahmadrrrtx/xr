import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as sizeGate from '../../scripts/size-gate';

describe('size-gate public contract survives the main/hardening merge', () => {
  // Owner-approved raise 176,500 → 177,000 for the stabilization hardening (2026-11-19, see
  // scripts/size-gate.ts and HARDENING_LOG.md). The pin still guards against a silent change.
  test('exports the existing owner-approved hardening ceiling', () => {
    expect(Reflect.get(sizeGate, 'TREE_CEILING')).toBe(177_000);
  });

  test('every stamp target retains its machine-readable ceiling marker', () => {
    for (const path of sizeGate.DOCS_STAMP_TARGETS) {
      expect(readFileSync(resolve(import.meta.dir, '../..', path), 'utf8'))
        .toContain('<!-- XR:TREE-CEILING -->177,000<!-- /XR:TREE-CEILING -->');
    }
  });

  test('the executable report uses that same finite ceiling and module bound', () => {
    const report = sizeGate.checkSizes();
    expect(Number.isFinite(report.treeCeiling)).toBe(true);
    expect(report.treeCeiling).toBe(177_000);
    expect(report.threshold).toBe(800);
    expect(report.treeOver).toBe(report.treeLines > report.treeCeiling);
  });
});
