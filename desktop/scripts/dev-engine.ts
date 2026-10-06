#!/usr/bin/env bun
/**
 * Phase 14 — dev launcher for the XR engine next to `bun run dev`.
 *
 * Boots the daemon from the repo root (`bun run src/index.ts serve`), mirrors
 * its output, and writes the per-boot bearer token it prints in its banner to
 * desktop/.xr-dev/token — the file the Vite proxy reads on every request. The
 * token never enters the browser bundle; it only travels proxy → daemon.
 *
 *   bun run engine                # port 3141, XR_HOME = ~/.xr (the real install)
 *   XR_HOME=~/.xr-dev bun run engine --port 3142
 *
 * The packaged app does not use this: the Tauri shell spawns the compiled
 * sidecar itself (src-tauri/src/commands/engine.rs).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const tokenDir = resolve(here, '..', '.xr-dev');
const tokenFile = resolve(tokenDir, 'token');

const args = process.argv.slice(2);
if (!args.includes('--port')) args.push('--port', process.env.XR_DEV_PORT ?? '3141');

mkdirSync(tokenDir, { recursive: true });
rmSync(tokenFile, { force: true });

const child = Bun.spawn(['bun', 'run', 'src/index.ts', 'serve', ...args], {
  cwd: repoRoot,
  env: { ...process.env, NO_COLOR: '1' },
  stdout: 'pipe',
  stderr: 'inherit',
});

let wrote = false;
const decoder = new TextDecoder();
let buffer = '';
(async () => {
  for await (const chunk of child.stdout) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      // Never echo the token to a shared terminal more than the daemon already does.
      console.log(line);
      const m = /Token:\s*([0-9a-f]{32,})/.exec(line);
      if (m && !wrote) {
        writeFileSync(tokenFile, m[1], { mode: 0o600 });
        wrote = true;
        console.log(`[dev-engine] token written to ${tokenFile} (read by the Vite proxy)`);
      }
    }
  }
})();

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  child.kill(); // SIGTERM — the engine drains and exits (bounded on its side too)
  // Belt and braces: never leave a half-dead engine holding the Vite "already
  // running" slot. 3 s is longer than the engine's own 2 s bounded exit.
  setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }, 3000).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
const code = await child.exited;
rmSync(tokenFile, { force: true });
process.exit(code);
