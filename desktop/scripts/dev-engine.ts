#!/usr/bin/env bun
/**
 * Phase 14 — dev launcher for the XR engine next to `bun run dev`.
 *
 * Boots the daemon from the repo root (`bun run src/index.ts serve`), mirrors
 * its output, and writes the per-boot bearer token it prints in its banner to
 * desktop/.xr-dev/token — the file the Vite proxy reads on every request. The
 * token never enters the browser bundle; it only travels proxy → daemon.
 *
 *   bun run engine                # port 3141, state = ~/.xr-desktop (independent of CLI)
 *   XR_DESKTOP_HOME=~/.xr-desktop-dev bun run engine --port 3142
 *
 * The packaged app does not use this: the Tauri shell spawns the compiled
 * sidecar itself (src-tauri/src/commands/engine.rs).
 */
import { desktopEngineHome } from './engine-home';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const tokenFile = resolve(process.env.XR_DEV_TOKEN_FILE ?? resolve(here, '..', '.xr-dev', 'token'));
const tokenDir = dirname(tokenFile);

const args = process.argv.slice(2);
if (args.some((a) => a === '--parent-pid' || a.startsWith('--parent-pid=')))
  throw new Error('The dev launcher owns --parent-pid.');
if (!args.some((a) => a === '--port' || a.startsWith('--port=')))
  args.push('--port', process.env.XR_DEV_PORT ?? '3141');
// Same private, parent-owned handshake as the native shell. Ordinary `serve`
// intentionally hides its bearer, so parsing its public banner cannot pair.
args.push('--parent-pid', String(process.pid));

mkdirSync(tokenDir, { recursive: true, mode: 0o700 });
rmSync(tokenFile, { force: true });

const child = Bun.spawn(['bun', 'run', 'src/index.ts', 'serve', ...args], {
  cwd: repoRoot,
  env: {
    ...process.env,
    XR_HOME: desktopEngineHome(),
    XR_DAEMON_TOKEN: undefined, // never pair using a CLI/other engine's bearer
    XR_PRINT_TOKEN: undefined, // only the captured parent handshake may reveal it
    XR_SECRET_NAMESPACE: 'desktop',
    NO_COLOR: '1',
  },
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
      // The capture is private. Neither bearer nor one-use browser bootstrap
      // credentials belong in the terminal/log forwarded by the launcher.
      if (!/Token:\s*[0-9a-f]{32,}/.test(line))
        console.log(line.replace(/\?(?:bootstrap|token)=[^\s]+/g, ''));
      const m = /Token:\s*([0-9a-f]{32,})/.exec(line);
      if (m && !wrote) {
        writeFileSync(tokenFile, m[1], { mode: 0o600 });
        wrote = true;
        console.log(
          `[dev-engine] token written to ${tokenFile} (read by the Vite proxy)`
        );
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
