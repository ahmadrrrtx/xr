"""Portable Linux PTY preservation replay. Unchanged XR entry, synthetic HTTP/1.1 provider.
Adapted from the supplied Phase-1 forensic fixture; no production/executor substitution.
"""
import argparse, errno, fcntl, http.server, json, os, pathlib, pty, select, signal, sqlite3, struct, subprocess, tempfile, termios, threading, time

ap = argparse.ArgumentParser()
ap.add_argument('--bun', required=True)
ap.add_argument('--repo', required=True)
ap.add_argument('--out', required=True)
a = ap.parse_args()
entry = pathlib.Path(a.repo).resolve() / 'src/index.ts'
out = pathlib.Path(a.out).resolve()
out.mkdir(parents=True, exist_ok=True)
records = []


def exercise(kind, shell_args=None):
    with tempfile.TemporaryDirectory(prefix='xr-a1-pty-') as t:
        root = pathlib.Path(t)
        home, cwd = root / 'home', root / 'workspace'
        home.mkdir(); cwd.mkdir()
        (cwd / 'package.json').write_text('{"name":"synthetic-pty-workspace","private":true}')
        calls = []

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            def log_message(self, *_): pass
            def send(self, body):
                data = json.dumps(body).encode()
                self.send_response(200)
                self.send_header('content-type', 'application/json')
                self.send_header('content-length', str(len(data)))
                self.end_headers(); self.wfile.write(data); self.wfile.flush()
            def do_GET(self): self.send({'data': [{'id': 'stub-model'}]})
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get('content-length', 0))))
                calls.append(body)
                tool_turn = len(calls) % 2 == 1 and not (kind == 'diff' and len(calls) == 3)
                tool = 'shell' if shell_args is not None else 'write_file'
                args = shell_args if shell_args is not None else {'path': 'marker.txt', 'content': 'SYNTHETIC_PTY_MARKER'}
                msg = {'role': 'assistant', 'content': 'Synthetic proposal.', 'tool_calls': [{'id': 'pty-' + str(len(calls)), 'type': 'function', 'function': {'name': tool, 'arguments': json.dumps(args)}}]} if tool_turn else {'role': 'assistant', 'content': json.dumps({'message': 'Offline PTY fixture done.', 'tool_calls': [], 'done': True})}
                self.send({'choices': [{'message': msg, 'finish_reason': 'tool_calls' if tool_turn else 'stop'}], 'usage': {'prompt_tokens': 5, 'completion_tokens': 7}})

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        provider = 'a1-pty-fixture'
        (home / 'config.json').write_text(json.dumps({'version': 22, 'defaults': {'provider': provider, 'model': 'stub-model'}, 'budget': {'perTaskUsd': 0.5, 'perTaskTokens': 250000}, 'providerEngine': {'routingStrategy': 'primary', 'customProviders': [{'id': provider, 'label': 'Offline PTY only', 'baseUrl': f'http://127.0.0.1:{server.server_port}/v1', 'defaultModel': 'stub-model', 'capabilities': {'chat': True, 'streaming': False, 'toolUse': True, 'functionCalling': True}}], 'providerCapabilities': {}}, 'security': {'egressAllowlist': [], 'hardened': True}, 'memory': {'enabled': False}}))
        (home / 'cli.json').write_text(json.dumps({'provider': provider, 'model': 'stub-model', 'permissions': {'allow': ['edit:*', 'shell:*'], 'deny': ['shell:printf*'] if shell_args is not None else []}}))
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 32, 110, 0, 0))
        text = ''
        env = {'PATH': str(pathlib.Path(a.bun).parent) + ':/usr/local/bin:/usr/bin:/bin', 'HOME': str(home), 'XR_HOME': str(home), 'CI': '1', 'NO_COLOR': '1', 'TERM': 'xterm-256color', 'XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER': '1', 'NODE_OPTIONS': '--max-old-space-size=512'}
        flag = '--approve-all' if shell_args is not None else '--diff' if kind == 'diff' else '--dry-run'
        cmd = [a.bun, 'run', str(entry), '--cwd', str(cwd), '--budget', '0.1234', '--no-history', flag]
        child = subprocess.Popen(cmd, cwd=cwd, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        def until(needle, start=0, timeout=20):
            nonlocal text
            deadline = time.monotonic() + timeout
            while needle not in text[start:]:
                remain = deadline - time.monotonic()
                if remain <= 0: raise RuntimeError('PTY deadline waiting for ' + repr(needle) + '; tail=' + text[-1800:])
                if not select.select([master], [], [], remain)[0]: continue
                try: data = os.read(master, 65536)
                except OSError as e:
                    if e.errno == errno.EIO: raise RuntimeError('PTY closed early: ' + text[-1800:])
                    raise
                if not data: raise RuntimeError('PTY EOF: ' + text[-1800:])
                text += data.decode(errors='replace')
        try:
            if shell_args is not None:
                until("Type 'yes' to continue:")
                os.write(master, b'yes\r')
            until('Ctrl+D exit.')
            os.write(master, b'First synthetic task\r')
            if kind == 'diff':
                until('+SYNTHETIC_PTY_MARKER')
                start = len(text); os.write(master, b'Second synthetic task without edits\r'); until('no edits proposed', start)
            elif shell_args is None:
                until('$0.1234 cap')
                start = len(text); os.write(master, b'Second synthetic task\r'); until('$0.1234 cap', start)
            else: until('$0.1234 cap')
            os.write(master, b'\x04')
            code = child.wait(timeout=10)
            while select.select([master], [], [], 0)[0]:
                try: data = os.read(master, 65536)
                except OSError: break
                if not data: break
                text += data.decode(errors='replace')
            db = sqlite3.connect(home / 'xr.db')
            audit = [{'event': row[0], 'detail': row[1]} for row in db.execute('select event, detail from audit_log order by id')]
            db.close(); events = [row['event'] for row in audit]
            record = {'case': kind, 'nativeTTY': True, 'argv': cmd, 'exitCode': code, 'chatCalls': len(calls), 'markerExists': (cwd / 'marker.txt').exists() or (cwd / 'denied-marker.txt').exists(), 'dryRunAuditCount': events.count('write_file.dryrun'), 'appliedWriteAuditCount': events.count('write_file.applied'), 'requestedBudgetMentions': text.count('$0.1234 cap'), 'diffRenderCount': text.count('+SYNTHETIC_PTY_MARKER'), 'noEditsNoticeCount': text.count('no edits proposed'), 'runtimeErrorShown': 'ended: error' in text or 'Network failure contacting' in text, 'stdout': text, 'requests': calls, 'audit': audit, 'scriptedProvider': True, 'paidModelCalls': False, 'assertionsBeforeCleanup': True}
            assert code == 0 and not record['markerExists'] and record['appliedWriteAuditCount'] == 0, record
            assert not record['runtimeErrorShown'], record
            if shell_args is not None:
                assert record['chatCalls'] == 2 and 'Auto-approval ON' in text, record
                assert 'shell.denied' in events, record
                assert not any(event in events for event in ['shell.run', 'shell.run_isolated', 'shell.isolated_blocked', 'shell.hardened_blocked']), record
                if isinstance(shell_args.get('cmd'), str): assert 'deny rule "shell:printf*"' in text, record
            elif kind == 'diff': assert record['chatCalls'] == 3 and record['diffRenderCount'] == 1 and record['noEditsNoticeCount'] == 1 and record['requestedBudgetMentions'] == 2, record
            else: assert record['chatCalls'] == 4 and record['dryRunAuditCount'] == 2 and record['requestedBudgetMentions'] >= 2, record
            return record
        finally:
            # Only fixture-owned child cleanup; a product hang has already failed above.
            if child.poll() is None: os.killpg(child.pid, signal.SIGKILL); child.wait(timeout=5)
            os.close(master); server.shutdown(); server.server_close(); thread.join(timeout=3)


for kind in ['dry-run', 'diff']:
    records.append(exercise(kind))
for index, args in enumerate([
    {'cmd': 'printf %s A1_POLICY_ONLY > denied-marker.txt'},
    {'cmd': 'printf %s A1_POLICY_ONLY > denied-marker.txt', 'command': 'harmless decoy'},
    {'command': 'printf %s A1_POLICY_ONLY > denied-marker.txt'},
    {'cmd': 123},
]):
    records.append(exercise('configured-deny-' + str(index), args))
path = out / 'pty-replay.json'
if path.exists(): raise RuntimeError('refuse to overwrite evidence')
path.write_text(json.dumps(records, indent=2))
print(json.dumps([{k: v for k, v in r.items() if k not in ['stdout', 'requests', 'audit']} for r in records], indent=2))
