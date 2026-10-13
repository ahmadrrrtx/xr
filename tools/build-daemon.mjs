/**
 * Bundle the daemon-side TypeScript modules to plain ESM so the reference
 * daemon (and tests) can import them without a TS runtime.
 *
 * The production repo runs them directly under Bun, which needs no build step.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = resolve(here, '.daemon-build');

mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [
    resolve(root, 'src/daemon/lan-tls.ts'),
    resolve(root, 'src/daemon/mobile-devices.ts'),
    resolve(root, 'src/daemon/mobile-pairing.ts'),
    resolve(root, 'src/daemon/web-push.ts'),
  ],
  outdir: outDir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  // tools/package.json has no "type": "module", so force .mjs extensions.
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
});

console.log('daemon modules →', outDir);
