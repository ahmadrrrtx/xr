import { spawn } from 'node:child_process';

// Process startup/module I/O is bounded separately from the security work.
// The previous single 1,500 ms wall deadline could not identify which hung.
export const NODE_STARTUP_DEADLINE_MS = 1500;
export const NODE_WORK_DEADLINE_MS = 500;
const PREFIX = 'XR_NODE_PROBE ';

type Phase = 'startup' | 'work' | 'complete';
export interface NodeProbeResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  deadlinePhase?: Phase;
  error?: string;
  phase: Phase;
  runtime?: { node: string; v8: string; executable: string; platform: string; arch: string };
  events: Array<Record<string, unknown>>;
  stdout: string;
  stderr: string;
  wallMs: number;
  readyWallMs?: number;
  workWallMs?: number;
}

/** A real Node child with an external watchdog; a blocked regex cannot stop it. */
export function realNodeProbe(options: {
  bootstrap?: string;
  work: string;
  startupMs?: number;
  workMs?: number;
}): Promise<NodeProbeResult> {
  const node = process.versions.bun ? Bun.which('node') : process.execPath;
  if (!node) throw new Error('Real Node is required for the security probe; no runtime substitution or skip');
  const source = `
    const assert = require('node:assert/strict');
    assert(process.versions.node && !process.versions.bun, 'security probe must execute real Node');
    ${options.bootstrap ?? ''}
    process.stdin.once('data', () => {
      const started = performance.now();
      ${options.work}
      console.log(${JSON.stringify(PREFIX)} + JSON.stringify({kind:'complete', workMs:performance.now()-started}));
    });
    console.log(${JSON.stringify(PREFIX)} + JSON.stringify({kind:'ready', node:process.versions.node,
      v8:process.versions.v8, executable:process.execPath, platform:process.platform, arch:process.arch}));
  `;
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(node, ['-e', source], { stdio: ['pipe', 'pipe', 'pipe'] });
    let phase: Phase = 'startup', timedOut = false, deadlinePhase: Phase | undefined;
    let stdout = '', stderr = '', pending = '', error: string | undefined, readyWallMs: number | undefined;
    let runtime: NodeProbeResult['runtime'], finished = false;
    const events: NodeProbeResult['events'] = [];
    const stop = (message: string) => { error = message; child.kill('SIGKILL'); };
    let watchdog = setTimeout(() => {
      timedOut = true; deadlinePhase = phase; stop('real Node startup/module-load deadline exceeded');
    }, options.startupMs ?? NODE_STARTUP_DEADLINE_MS);
    const finish = (exitCode: number | null, signal: string | null) => {
      if (finished) return;
      finished = true; clearTimeout(watchdog);
      const wallMs = performance.now() - started;
      resolve({ exitCode, signal, timedOut, deadlinePhase, error, phase, runtime, events, stdout, stderr,
        wallMs, readyWallMs, workWallMs: readyWallMs === undefined ? undefined : wallMs - readyWallMs });
    };
    child.on('error', (reason) => { error = reason.message; finish(null, null); });
    child.on('close', finish);
    child.stdin.on('error', (reason) => { stop(`probe control pipe: ${reason.message}`); });
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8'); stdout += text; pending += text;
      if (stdout.length > 65536) { stdout = stdout.slice(-65536); stop('probe stdout exceeded bounded diagnostics'); return; }
      let end: number;
      while ((end = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        if (!line.startsWith(PREFIX)) continue;
        let event: Record<string, unknown>;
        try { event = JSON.parse(line.slice(PREFIX.length)); }
        catch { stop('invalid Node probe protocol'); return; }
        events.push(event);
        if (event.kind === 'ready') {
          if (phase !== 'startup') { stop('duplicate Node readiness event'); return; }
          runtime = event as unknown as NonNullable<NodeProbeResult['runtime']>;
          readyWallMs = performance.now() - started; phase = 'work'; clearTimeout(watchdog);
          watchdog = setTimeout(() => {
            timedOut = true; deadlinePhase = phase; stop('real Node compile/match/exit deadline exceeded');
          }, options.workMs ?? NODE_WORK_DEADLINE_MS);
          child.stdin.end('run\n');
        } else if (event.kind === 'complete') {
          if (phase !== 'work') { stop('Node completion without a work phase'); return; }
          phase = 'complete';
        }
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 65536) { stderr = stderr.slice(-65536); stop('probe stderr exceeded bounded diagnostics'); }
    });
  });
}
