import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const read = (path: string) => readFileSync(resolve(import.meta.dir, '../..', path), 'utf8');

test('mobile settings explicitly require trusted TLS and connect to local start/stop', () => {
  const settings = read('desktop/src/screens/Settings/index.tsx');
  const tab = read('desktop/src/screens/Settings/tabs/MobileTab.tsx');
  expect(settings).toContain("active === 'mobile' ? <MobileTab />");
  expect(tab).toContain("'/mobile/desktop/start'");
  expect(tab).toContain("'/mobile/desktop/stop'");
  expect(tab).toContain('Never bypass a browser TLS warning');
  expect(tab).toContain('!confirmed');
  const card = read('desktop/src/components/settings/MobileCard.tsx');
  expect(card).not.toContain('Tap “Visit Website”');
  expect(card).toContain('Never bypass a TLS warning');
});
