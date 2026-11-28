/** NEW-23: Unix SIGTERM must enter Tauri's ordered clean-exit path. */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

describe('NEW-23 · SIGTERM is converted to clean desktop shutdown', () => {
  test('the Unix handler is installed and its monitor requests Tauri exit before the event loop runs', () => {
    const shell = read('desktop/src-tauri/src/lib.rs');
    const unix = read('desktop/src-tauri/src/unix.rs');
    const install = shell.indexOf('unix::install_sigterm_handler()');
    const monitor = shell.indexOf('unix::spawn_sigterm_monitor');
    const eventLoop = shell.indexOf('app.run(move |app, event|');

    expect(install).toBeGreaterThan(-1);
    expect(monitor).toBeGreaterThan(install);
    expect(eventLoop).toBeGreaterThan(monitor);
    expect(shell.slice(monitor, eventLoop)).toContain('shutdown.exit(0)');
    expect(shell.slice(eventLoop)).toContain('crash::clear_flag(&home)');
    expect(shell.slice(eventLoop)).toContain('engine::stop_sidecar');
    expect(unix).toContain('SIGTERM_REQUESTED.store(true, Ordering::SeqCst)');
    expect(unix).toContain('libc::signal(libc::SIGTERM, record_sigterm as libc::sighandler_t)');
    expect(unix).toContain('sigterm_request_is_dispatched_once_to_the_clean_exit_path');
  });

  test('the async signal handler only records the request; normal thread owns exit work', () => {
    const unix = read('desktop/src-tauri/src/unix.rs');
    const handler = unix.split('extern "C" fn record_sigterm')[1]?.split('\n}')[0] ?? '';
    expect(handler).toContain('SIGTERM_REQUESTED.store(true, Ordering::SeqCst)');
    expect(handler).not.toMatch(/\.exit\(|log_shell|format!|std::fs|println!/);
    expect(unix).toContain('on_signal();');
  });
});
