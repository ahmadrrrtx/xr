import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { packPicomatch, PICOMATCH_FILES, PICOMATCH_PAYLOAD } from '../../scripts/vendor-picomatch';
import { lockedDependencies } from '../../scripts/sbom';

const root = resolve(import.meta.dir, '../..');
const vendor = resolve(root, 'vendor/picomatch');
const read = (p: string) => readFileSync(resolve(vendor, p));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const provenance = JSON.parse(read('XR-PROVENANCE.json').toString()) as {
  upstream: { version: string; sha256: string; integrity: string; gitCommit: string };
  files: Record<string, string>;
  modified: Record<string, { upstreamSha256: string; patchedSha256: string }>;
  patchSha256: string;
};
const tarball = readFileSync(resolve(root, PICOMATCH_PAYLOAD));
const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
const parseJson = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8').replace(/,([\t\r\n ]*[}\]])/g, '$1'));

test('retained upstream bytes match the independently pinned npm archive, not just an editable inventory', () => {
  const archive = read('UPSTREAM-4.0.7.tgz');
  expect(sha(archive)).toBe('697b463be3cdbd9ffc8f4194fd5019a69ddf95875fb703d78b2b115cc9e740a8');
  const tar = gunzipSync(archive), found: string[] = [];
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    const field = (start: number, end: number) => header.subarray(start, end).toString().replace(/\0.*$/, '');
    const name = field(0, 100), size = parseInt(field(124, 136).trim() || '0', 8);
    if (!name) break;
    expect(Number.isSafeInteger(size) && size >= 0).toBe(true);
    expect(header[156] === 0 || header[156] === 48).toBe(true);
    expect(name).toStartWith('package/');
    const path = name.slice('package/'.length);
    expect(path).not.toContain('..');
    found.push(path);
    const blob = tar.subarray(offset + 512, offset + 512 + size);
    expect(sha(blob)).toBe(provenance.files[path]!);
    expect(blob.equals(read(provenance.modified[path] ? `${path}.upstream` : path))).toBe(true);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  expect(found.sort()).toEqual(Object.keys(provenance.files).sort());
});

test('private fork preserves all ten checksum-verified upstream files except the reviewed parser/metadata delta', () => {
  expect(provenance.upstream.version).toBe('4.0.7');
  expect(provenance.upstream.sha256).toBe('697b463be3cdbd9ffc8f4194fd5019a69ddf95875fb703d78b2b115cc9e740a8');
  expect(provenance.upstream.gitCommit).toBe('6bb40679c218cefba5d4e9662408c5fdf699a8bb');
  expect(Object.keys(provenance.files)).toHaveLength(10);
  expect(Object.keys(provenance.modified).sort()).toEqual(['lib/parse.js', 'package.json']);
  for (const [path, hash] of Object.entries(provenance.files)) {
    expect(sha(read(provenance.modified[path] ? `${path}.upstream` : path))).toBe(hash);
    if (provenance.modified[path]) expect(sha(read(path))).toBe(provenance.modified[path]!.patchedSha256);
  }
  expect(sha(read('XR-SECURITY.patch'))).toBe(provenance.patchSha256);
  expect(PICOMATCH_FILES).toContain('LICENSE');
  const pkg = JSON.parse(read('package.json').toString());
  expect(pkg.name).toBe('@xr/picomatch-security');
  expect(pkg.version).toBe('4.0.7-xr.2');
  expect(pkg.private).toBe(true);
});

test('compatibility restrictions retain the unchanged upstream failures and exact parser identity', () => {
  const report = JSON.parse(read('XR-COMPATIBILITY-RESULTS.json').toString());
  expect(report.upstreamTestsUnchanged).toBe(true);
  expect(report.parserSha256).toBe(sha(read('lib/parse.js')));
  expect(report.stats.tests).toBe(1983);
  expect(report.stats.passes).toBe(1917);
  expect(report.stats.failures).toBe(66);
  expect(report.failures).toHaveLength(66);
  expect(report.exitCode).not.toBe(0);
});

test('the installed tarball is byte-for-byte reproducible from the reviewed source', () => {
  expect(packPicomatch(root).equals(tarball)).toBe(true);
  expect(packPicomatch(root).equals(packPicomatch(root))).toBe(true);
});

test('all six project manifests resolve picomatch to the one private, unpublished security payload', () => {
  for (const project of ['.', 'desktop', 'mobile', 'tools', 'website', 'extensions/vscode']) {
    const pkg = parseJson(`${project}/package.json`);
    expect(pkg.overrides.picomatch).toBe('$picomatch');
    const spec = pkg.devDependencies.picomatch as string;
    expect(spec).toBe(`file:${relative(resolve(root, project), resolve(root, PICOMATCH_PAYLOAD)).replaceAll('\\', '/')}`);
  }
});

test('all five Bun graphs contain the same fork/hash, with no remaining registry picomatch copy', () => {
  for (const lockPath of ['bun.lock', 'desktop/bun.lock', 'mobile/bun.lock', 'tools/bun.lock', 'website/bun.lock']) {
    const lock = parseJson(lockPath);
    const rows = Object.entries(lock.packages).filter(([k]) => /(^|\/)picomatch$/.test(k));
    expect(rows.length).toBeGreaterThan(0);
    for (const [, value] of rows) {
      const entry = value as unknown[];
      expect(String(entry[0])).toStartWith('@xr/picomatch-security@');
      expect(entry).toContain(integrity);
    }
    const fork = lockedDependencies(resolve(root, lockPath)).find(p => p.name === '@xr/picomatch-security');
    expect(fork?.version).toBe('4.0.7-xr.2');
    expect(fork?.integrity).toBe(integrity);
  }
});

test('all four npm graphs retain the actual fork name/version and exact local tarball SRI', () => {
  for (const lockPath of ['mobile/package-lock.json', 'tools/package-lock.json', 'website/package-lock.json', 'extensions/vscode/package-lock.json']) {
    const lock = parseJson(lockPath);
    const rows = Object.entries(lock.packages).filter(([k]) => /(^|\/)picomatch$/.test(k));
    expect(rows.length).toBeGreaterThan(0);
    for (const [, value] of rows) {
      const entry = value as { name: string; version: string; integrity: string; resolved: string };
      expect(entry.name).toBe('@xr/picomatch-security');
      expect(entry.version).toBe('4.0.7-xr.2');
      expect(entry.integrity).toBe(integrity);
      expect(entry.resolved).toContain('picomatch-security-4.0.7-xr.2.tgz');
    }
  }
});

test('the actually installed root package contains the reviewed code, not just a changed lockfile label', () => {
  const require = createRequire(resolve(root, 'package.json'));
  const entry = require.resolve('picomatch/package.json');
  const installed = resolve(entry, '..');
  for (const path of PICOMATCH_FILES) expect(readFileSync(resolve(installed, path)).equals(read(path))).toBe(true);
  const pm = require('picomatch') as { makeRe(p: string): RegExp };
  expect(pm.makeRe('+(*a)').source).toContain('\\+\\(');
});
