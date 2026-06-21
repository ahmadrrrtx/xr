import type { Action, ActionResult } from "./types.ts";
type AnyPage = any; let cached: { browser:any; context:any; page:any; pages:any[] } | null = null;
function ok(m:string,data?:unknown):ActionResult{ return {ok:true, message:m, ...(data?{data}:{})}}
function fail(m:string):ActionResult{ return {ok:false, message:m}}

export function browserAvailable(){ try{ require.resolve("playwright"); return {available:true}; } catch{ return {available:false, reason:"playwright not installed – run: xr control browser install"} } }

async function ensurePage(idx=0){
  if(cached?.pages?.[idx] && !cached.pages[idx].isClosed?.()) return { page: cached.pages[idx] };
  const pw = await import("playwright" as any);
  if(!cached){ const browser=await pw.chromium.launch({ headless: process.env.XR_BROWSER_HEADLESS==="1"}); const context=await browser.newContext({viewport:{width:1280,height:800}}); const page=await context.newPage(); cached={browser,context,page,pages:[page]}; }
  return { page: cached.pages[idx] ?? cached.page };
}

export async function executeBrowserAction(action: Extract<Action,{type:"browser"}>): Promise<ActionResult> {
  if(action.op==="close"){ if(cached){ try{await cached.context.close(); await cached.browser.close();}catch{} cached=null;} return ok("browser closed"); }
  const probe=browserAvailable(); if(!probe.available) return fail(probe.reason!);
  const ready = await ensurePage(action.tabIndex||0); if("error" in ready) return fail((ready as any).error);
  const page = (ready as any).page; const timeout = action.timeoutMs ?? 5000;
  try{
    switch(action.op){
      case "goto": if(!action.value) return fail("goto needs value"); await page.goto(action.value,{timeout,waitUntil:"domcontentloaded"}); return ok(`navigated to ${action.value}`);
      case "click": if(!action.selector) return fail("click needs selector"); await page.click(action.selector,{timeout}); return ok(`clicked ${action.selector}`);
      case "fill": if(!action.selector||action.value==null) return fail("fill needs selector+value"); await page.fill(action.selector, action.value, {timeout}); return ok(`filled ${action.selector}`);
      case "type": await page.type(action.selector||":focus", action.value||"", {delay:12,timeout}); return ok("typed");
      case "press": await (action.selector? page.press(action.selector, action.value||"Enter",{timeout}) : page.keyboard.press(action.value||"Enter")); return ok(`pressed ${action.value}`);
      case "wait": await page.waitForSelector(action.selector!,{timeout}); return ok("wait ok");
      case "submit": if(action.selector){ await page.locator(action.selector).evaluate((el:any)=>{ const f=el.closest("form")??el; if(typeof f.submit==="function") f.submit(); }); } else { await page.keyboard.press("Enter"); } return ok("submitted");
      case "extract": { const text=await page.locator(action.selector!).first().innerText({timeout}); return ok(`extracted ${text.length} chars`, { text });}
      case "screenshot": { const path = action.value || `/tmp/xr-browser-${Date.now()}.png`; await page.screenshot({path, fullPage:false}); return ok(`screenshot ${path}`, { path });}
      case "new_tab": { const p = await cached!.context.newPage(); cached!.pages.push(p); return ok(`new tab ${cached!.pages.length-1}`);}
      case "close_tab": { const idx=action.tabIndex||0; if(cached!.pages[idx]){ await cached!.pages[idx].close(); cached!.pages.splice(idx,1);} return ok("tab closed");}
      case "switch_tab": { return ok(`switched to tab ${action.tabIndex}`);}
      case "upload": { if(!action.selector||!action.value) return fail("upload needs selector+path"); await page.setInputFiles(action.selector, action.value); return ok("uploaded");}
      case "drag": { return fail("browser drag not yet implemented – use desktop drag_drop"); }
    }
  } catch(e){ return fail(`browser ${action.op} failed: ${(e as Error).message}`);}
  return fail("unknown op");
}
export function browserStatus(){ const probe=browserAvailable(); return { installed:probe.available, reason:probe.reason, active:!!cached?.page, url: cached?.page ? cached.page.url?.() : undefined };}
export async function shutdownBrowser(){ if(cached){ try{await cached.context.close(); await cached.browser.close();}catch{} cached=null; } }
