/** Local packages need a real identity and integrity, never a path-as-version. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { packPicomatch, PICOMATCH_PAYLOAD } from './vendor-picomatch';

export function vendoredDependency(spec: string, lockPath: string, integrity?: string) {
  const prefix = '@xr/picomatch-security@';
  if (!spec.startsWith(prefix)) return null;
  const root = resolve(import.meta.dir, '..');
  const path = resolve(dirname(resolve(lockPath)), spec.slice(prefix.length).replace(/^file:/, ''));
  if (path !== resolve(root, PICOMATCH_PAYLOAD)) throw new Error('Unexpected private picomatch payload path');
  const bytes = readFileSync(path);
  const actual = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (!integrity || actual !== integrity || !bytes.equals(packPicomatch(root)))
    throw new Error('Private picomatch integrity/source mismatch');
  const pkg = JSON.parse(readFileSync(resolve(root, 'vendor/picomatch/package.json'), 'utf8'));
  if (pkg.name !== '@xr/picomatch-security' || pkg.version !== '4.0.7-xr.2' || pkg.private !== true)
    throw new Error('Unexpected private picomatch identity');
  return { name: pkg.name as string, version: pkg.version as string, integrity: actual,
    localPatch: 'vendor/picomatch/XR-SECURITY.patch', upstream: 'picomatch@4.0.7' };
}
