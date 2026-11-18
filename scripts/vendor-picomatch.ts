/** Reproducible local fork payload, not npm publication. No network or scripts. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const PICOMATCH_FILES = [
  'LICENSE', 'README.md', 'XR-PATCH.md', 'index.js', 'lib/constants.js',
  'lib/parse.js', 'lib/picomatch.js', 'lib/scan.js', 'lib/utils.js',
  'package.json', 'posix.js',
] as const;
export const PICOMATCH_PAYLOAD = 'vendor/picomatch-security-4.0.7-xr.2.tgz';

/** RFC 1952 gzip with stored DEFLATE blocks: byte-identical across OS/zlib.
 * A small size tradeoff avoids relying on a platform-specific compressor. */
function canonicalGzip(bytes: Buffer): Buffer {
  const chunks: Buffer[] = [Buffer.from('1f8b08000000000000ff', 'hex')];
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  for (let offset = 0; offset < bytes.length; offset += 65535) {
    const length = Math.min(65535, bytes.length - offset), header = Buffer.alloc(5);
    header[0] = offset + length === bytes.length ? 1 : 0;
    header.writeUInt16LE(length, 1); header.writeUInt16LE(length ^ 0xffff, 3);
    chunks.push(header, bytes.subarray(offset, offset + length));
  }
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 0);
  trailer.writeUInt32LE(bytes.length >>> 0, 4);
  return Buffer.concat([...chunks, trailer]);
}

/** Minimal deterministic USTAR writer for this explicit, regular-file-only set.
 * Fixed modes, zero uid/gid/mtime, no host paths, and canonical gzip headers. */
export function packPicomatch(root = resolve(import.meta.dir, '..')): Buffer {
  const chunks: Buffer[] = [];
  for (const path of PICOMATCH_FILES) {
    const blob = readFileSync(resolve(root, 'vendor/picomatch', path));
    const header = Buffer.alloc(512);
    const field = (value: string, offset: number, bytes: number) => {
      if (Buffer.byteLength(value) >= bytes) throw new Error('USTAR field overflow');
      header.write(value, offset, bytes, 'utf8');
    };
    const octal = (value: number, offset: number, bytes: number) =>
      field(value.toString(8).padStart(bytes - 1, '0'), offset, bytes);
    field(`package/${path}`, 0, 100);
    octal(0o644, 100, 8); octal(0, 108, 8); octal(0, 116, 8);
    octal(blob.length, 124, 12); octal(0, 136, 12);
    header.fill(32, 148, 156);
    header[156] = 48;
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    chunks.push(header, blob, Buffer.alloc((512 - blob.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return canonicalGzip(Buffer.concat(chunks));
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..');
  const expected = packPicomatch(root), path = resolve(root, PICOMATCH_PAYLOAD);
  if (process.argv.includes('--write')) {
    writeFileSync(path, expected);
    console.log(`Wrote deterministic private payload: ${PICOMATCH_PAYLOAD}`);
  } else {
    if (!readFileSync(path).equals(expected))
      throw new Error('Vendored picomatch tarball differs from reviewed source; do not install it.');
    console.log('Vendored picomatch payload matches the exact reviewed source.');
  }
}
