/** Black-box: the ordinary dev command must feed the proxy, never the browser/terminal, a bearer. */
import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('default dev launcher publishes a private proxy token and enforces daemon authentication', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xr-dev-handshake-'));
  const tokenFile = join(dir, 'proxy', 'token');
  const env = { ...process.env, XR_DESKTOP_HOME: join(dir, 'home'), XR_DEV_TOKEN_FILE: tokenFile,
    XR_SECRET_BACKEND: 'file', NO_COLOR: '1' };
  delete env.XR_DAEMON_TOKEN;
  delete env.XR_PRINT_TOKEN;
  const proc = Bun.spawn([process.execPath, 'run', 'scripts/dev-engine.ts', '--port', '0'], {
    cwd: resolve(import.meta.dir, '../../desktop'), env, stdout: 'pipe', stderr: 'pipe',
  });
  let output = '';
  const drain = (async () => { for await (const chunk of proc.stdout) output += new TextDecoder().decode(chunk); })();
  const errors = new Response(proc.stderr).text();
  try {
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline && !existsSync(tokenFile) && proc.exitCode === null)
      await Bun.sleep(25);
    expect(existsSync(tokenFile)).toBe(true);
    const token = readFileSync(tokenFile, 'utf8').trim();
    const port = /Listening on\s+http:\/\/127\.0\.0\.1:(\d+)/.exec(output)?.[1];
    expect(port).toBeDefined();
    expect(token).toMatch(/^[0-9a-f]{32,}$/);
    if (process.platform !== 'win32') expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
    const base = `http://127.0.0.1:${port}/api/v1`;
    const req = (bearer?: string) => fetch(`${base}/meta/version`, {
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {}, signal: AbortSignal.timeout(2_000),
    });
    expect((await req()).status).toBe(401);
    expect((await req('invalid')).status).toBe(401);
    expect((await req(token)).status).toBe(200);
    expect(output).not.toContain(token);
    expect(output).not.toContain('?bootstrap=');
  } finally {
    proc.kill('SIGTERM');
    const killed = setTimeout(() => proc.kill('SIGKILL'), 4_000);
    await proc.exited;
    clearTimeout(killed);
    await drain;
    await errors;
    rmSync(dir, { recursive: true, force: true });
  }
  expect(existsSync(tokenFile)).toBe(false);
}, 15_000);
