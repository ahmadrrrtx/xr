import {expect,test} from 'bun:test';import {existsSync,mkdtempSync,rmSync}from'node:fs';import {tmpdir}from'node:os';import{join}from'node:path';
import{boundedCheck}from'../../scripts/lib/bounded-check';
test.if(process.platform!=='win32')('watchdog actually terminates a delayed descendant; no late fixture effect',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'xr-check-watchdog-')),marker=join(dir,'marker');
 try{const r=await boundedCheck(['/bin/sh','-c',`(sleep .25; echo bad > '${marker}') & wait`],{cwd:dir,env:{PATH:'/usr/bin:/bin'},timeoutMs:35});
 expect(r.timedOut).toBe(true);expect(r.exitCode).not.toBe(0);await Bun.sleep(350);expect(existsSync(marker)).toBe(false);
 const ok=await boundedCheck(['/bin/sh','-c','printf verified'],{cwd:dir,env:{PATH:'/usr/bin:/bin'},timeoutMs:1000});expect(ok.exitCode).toBe(0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
