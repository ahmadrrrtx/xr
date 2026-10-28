#!/usr/bin/env node
/**
 * V1-P5-003 — fail fast with the FIX when mobile:test prerequisites are
 * missing, instead of a bare ERR_MODULE_NOT_FOUND deep inside a test run.
 *
 * Deliberately dependency-free (node:fs only) so it can run before
 * `npm --prefix tools install` ever happened.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const missing = [];

if (!existsSync(join(root, 'tools', 'node_modules', 'web-push'))) {
  missing.push('npm --prefix tools install        # tools/ has its own package.json (puppeteer, web-push, …)');
}
if (!existsSync(join(root, 'tools', '.daemon-build', 'mobile-devices.mjs'))) {
  missing.push('node tools/build-daemon.mjs        # a.k.a. bun run mobile:daemon:build — builds .daemon-build/*');
}

if (missing.length) {
  console.error('✋ mobile:test prerequisites are missing. Run first:\n');
  for (const line of missing) console.error(`  ${line}`);
  console.error('\n(see docs/mobile/PWA.md §8)');
  process.exit(1);
}
