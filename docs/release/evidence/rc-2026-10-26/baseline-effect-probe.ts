import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NamespaceSandboxBackend } from '/home/user/xr/src/runtime/trust/environment/namespace.ts';
const base = mkdtempSync(join(tmpdir(), 'xr-audit-sandbox-'));
const ws = join(base, 'ws'), ro = join(base, 'ro'), sibling = join(base, 'sibling');
mkdirSync(ws); mkdirSync(ro); writeFileSync(join(ro,'canary'), 'ORIGINAL'); writeFileSync(sibling,'SIBLING');
const b = new NamespaceSandboxBackend({only:'unshare'});
const available = await b.detect();
const run = (cmd:string) => b.run({argv:['/bin/sh','-c',cmd],cwd:ws,env:{},timeoutMs:5000,maxOutputBytes:4096}, {grant:{fs:{writableRoots:[ws],readOnlyRoots:[ro],blockedPaths:[]}, net:{mode:'none', allowlist:[]}}, envInject:{}} as never);
try {
 const scratch = await run(`echo scratch > '${sibling}'`);
 const remount = await run(`mount -o remount,bind,rw '${ro}' && printf CHANGED > '${ro}/canary'`);
 const result = {available, privateTmpWrite:{ok:scratch.ok, hostSibling:readFileSync(sibling,'utf8')}, readonlyRemount:{ok:remount.ok,exitCode:remount.exitCode,stderr:remount.stderr,hostCanary:readFileSync(join(ro,'canary'),'utf8')}};
 console.log(JSON.stringify(result,null,2));
} finally { rmSync(base,{recursive:true,force:true}); }
