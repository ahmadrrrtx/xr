import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as sizeGate from '../../scripts/size-gate';

describe('size-gate public contract survives the main/hardening merge', () => {
  test('exports the existing owner-approved hardening ceiling', () => {
    expect(Reflect.get(sizeGate, 'TREE_CEILING')).toBe(176_500);
  });

  test('every stamp target retains its machine-readable ceiling marker', () => {
    for (const path of sizeGate.DOCS_STAMP_TARGETS) {
      expect(readFileSync(resolve(import.meta.dir, '../..', path), 'utf8'))
        .toContain('<!-- XR:TREE-CEILING -->176,500<!-- /XR:TREE-CEILING -->');
    }
  });

  test('the executable report uses that same finite ceiling and module bound', () => {
    const report = sizeGate.checkSizes();
    expect(Number.isFinite(report.treeCeiling)).toBe(true);
    expect(report.treeCeiling).toBe(176_500);
    expect(report.threshold).toBe(800);
    expect(report.treeOver).toBe(report.treeLines > report.treeCeiling);
  });
});
