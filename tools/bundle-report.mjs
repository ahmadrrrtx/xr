#!/usr/bin/env node
/**
 * Bundle budget report for the mobile PWA.
 *
 *   node tools/bundle-report.mjs
 *
 * Splits the build into "critical path" (what a cold start downloads) and
 * "on demand" (code-split), and fails if the 200 KB gz budget is blown.
 */
import { readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(here, '..', 'mobile', 'dist');

/** Chunks loaded lazily (React.lazy / dynamic import). */
const ON_DEMAND = ['markdown'];

const BUDGET_KB = 200;
const CRITICAL_BUDGET_KB = 140;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let total = 0;
let critical = 0;
const rows = [];

for (const file of walk(DIST)) {
  if (!/\.(js|css|html)$/.test(file)) continue;
  const buffer = await readFile(file);
  const gz = gzipSync(buffer, { level: 9 }).length;
  const name = file.replace(`${DIST}/`, '');
  const lazy = ON_DEMAND.some((key) => name.includes(key));
  rows.push({ name, raw: buffer.length, gz, lazy });
  total += gz;
  if (!lazy) critical += gz;
}

rows.sort((a, b) => b.gz - a.gz);

console.log('\nXR mobile bundle (gzip)\n');
console.log('  file                                   raw       gz    path');
console.log('  ' + '-'.repeat(64));
for (const row of rows) {
  console.log(
    `  ${row.name.padEnd(36)} ${kb(row.raw).padStart(7)} ${kb(row.gz).padStart(7)}   ${row.lazy ? 'on demand' : 'critical'}`,
  );
}

console.log('  ' + '-'.repeat(64));
console.log(`  ${'CRITICAL PATH (first load)'.padEnd(36)} ${''.padStart(7)} ${kb(critical).padStart(7)}`);
console.log(`  ${'TOTAL (incl. lazy)'.padEnd(36)} ${''.padStart(7)} ${kb(total).padStart(7)}`);
console.log(`\n  Budget: critical < ${CRITICAL_BUDGET_KB} KB gz, total < ${BUDGET_KB} KB gz`);

const okCritical = critical < CRITICAL_BUDGET_KB * 1024;
const okTotal = total < BUDGET_KB * 1024;
console.log(`  ${okCritical ? '✓' : '✗'} critical   ${okTotal ? '✓' : '✗'} total\n`);

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)}K`;
}

process.exit(okCritical && okTotal ? 0 : 1);
