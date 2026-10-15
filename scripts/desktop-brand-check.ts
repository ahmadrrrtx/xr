/**
 * Desktop brand registry check (Phase 31 · Bucket F v2, F9).
 *
 *   bun run scripts/desktop-brand-check.ts           verify REGISTRY.json
 *   bun run scripts/desktop-brand-check.ts --write   regenerate REGISTRY.json
 *
 * The registry (desktop/src/assets/REGISTRY.json) pins every shipped
 * desktop brand surface — desktop/src/assets/** (logo/emblem/avatar,
 * Orb v2, avatar-state GIFs) and the 17 desktop/src-tauri/icons files —
 * with byte size + sha256. The check fails (exit 1) on any missing file,
 * size/hash drift, or unregistered brand file, so a stale or truncated
 * asset can never ship silently.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const ASSETS_DIR = join(ROOT, 'desktop', 'src', 'assets');
const ICONS_DIR = join(ROOT, 'desktop', 'src-tauri', 'icons');
const REGISTRY = join(ASSETS_DIR, 'REGISTRY.json');

interface Entry {
  path: string;
  bytes: number;
  sha256: string;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function entryFor(abs: string): Entry {
  const buf = readFileSync(abs);
  return {
    path: relative(ROOT, abs).split('\\').join('/'),
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
  };
}

function collect(): Entry[] {
  const files = [
    ...walk(ASSETS_DIR).filter((f) => !f.endsWith('REGISTRY.json')),
    ...walk(ICONS_DIR),
  ];
  return files.map(entryFor).sort((a, b) => a.path.localeCompare(b.path));
}

if (process.argv.includes('--write')) {
  const entries = collect();
  writeFileSync(
    REGISTRY,
    JSON.stringify(
      {
        $comment:
          'Phase 31 Bucket F v2 — shipped desktop brand surfaces. Regenerate: bun run scripts/desktop-brand-check.ts --write. Sources: assets/v2/MANIFEST.json (Drive pack).',
        generatedFrom: 'assets/v2 (Drive pack)',
        files: entries,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`REGISTRY.json written: ${entries.length} files`);
  process.exit(0);
}

if (!existsSync(REGISTRY)) {
  console.error('REGISTRY.json missing — run with --write');
  process.exit(1);
}

const registered: Entry[] = JSON.parse(readFileSync(REGISTRY, 'utf8')).files;
const byPath = new Map(registered.map((e) => [e.path, e]));
const problems: string[] = [];

for (const e of registered) {
  const abs = join(ROOT, e.path);
  if (!existsSync(abs)) {
    problems.push(`MISSING ${e.path}`);
    continue;
  }
  const now = entryFor(abs);
  if (now.bytes !== e.bytes) problems.push(`SIZE ${e.path}: registry ${e.bytes} != actual ${now.bytes}`);
  if (now.sha256 !== e.sha256) problems.push(`SHA256 ${e.path}: drifted`);
}
for (const now of collect()) {
  if (!byPath.has(now.path)) problems.push(`UNREGISTERED ${now.path} (run --write)`);
}

if (problems.length) {
  console.error(`brand check FAILED (${problems.length}):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`brand check OK: ${registered.length} files verified (desktop assets + Tauri icons)`);
