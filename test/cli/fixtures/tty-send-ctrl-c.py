#!/usr/bin/env python3
"""Linux PTY fixture: send a real terminal Ctrl+C to an XR launcher."""
import json
import os
import pty
import select
import signal
import sys
import time

node, launcher = sys.argv[1:3]
pid, master = pty.fork()
if pid == 0:
    env = dict(os.environ)
    env['PATH'] = ''
    env.pop('XR_BINARY', None)
    env.pop('NODE_PATH', None)
    os.execve(node, [node, launcher], env)

output = b''
error = ''
try:
    deadline = time.monotonic() + 5
    while b'READY' not in output and time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], 0.1)
        if ready:
            output += os.read(master, 4096)
    if b'READY' not in output:
        error = 'child did not become ready'
    else:
        os.write(master, b'\x03')
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            ready, _, _ = select.select([master], [], [], 0.1)
            if ready:
                try:
                    output += os.read(master, 4096)
                except OSError:
                    break
finally:
    # The pty child is a session/process-group leader. Kill only this test group.
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass
    os.close(master)
print(json.dumps({'output': output.decode(errors='replace'), 'error': error}))
