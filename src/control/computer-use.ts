import type { Provider } from "../core/types.ts";
import type { Store } from "../state/db.ts";
import { captureScreen, ocrImage } from "./vision.ts";
import { execute } from "./executor.ts";
import type { Action } from "./types.ts";

export interface ComputerUseOptions {
  provider: Provider;
  store: Store;
  task: string;
  maxSteps?: number;
  onStep?: (step:number, action:Action, ok:boolean, msg:string)=>void;
}

function parseAction(text:string): Action | null {
  try { const m=text.match(/\{[\s\S]*"type"[\s\S]*\}/); if(m){ const o=JSON.parse(m[0]); if(o.type) return o as Action; } } catch{}
  const low=text.toLowerCase();
  const cm=text.match(/click.*?(\d+)[,\s]+(\d+)/i); if(cm) return {type:"click", x:Number(cm[1]), y:Number(cm[2]), button:"left"};
  const tm=text.match(/type[:\s]+(.+)/i); if(tm) return {type:"type", text: tm[1].trim().slice(0,500)};
  if(low.includes("scroll down")) return {type:"scroll", direction:"down", amount:3};
  if(low.includes("scroll up")) return {type:"scroll", direction:"up", amount:3};
  if(/done|complete|finish/.test(low)) return null;
  return null;
}

export async function runComputerUse(opts: ComputerUseOptions): Promise<string> {
  const { provider, store, task, maxSteps=20, onStep } = opts;
  for (let step=1; step<=maxSteps; step++){
    const cap = await captureScreen(); if(!cap.ok || !cap.base64) return `screenshot failed: ${cap.message}`;
    const screenText = await ocrImage(cap.base64);
    const prompt = `You are XR Computer-Use. Task: ${task}\nScreen OCR:\n${screenText.slice(0,2000)}\n\nReply with ONE JSON action only. Allowed types: click, type, scroll, key, app, open, drag_drop, wait_ms.\nExample: {"type":"click","x":640,"y":480,"button":"left"}\nIf task is complete, reply: {"type":"wait_ms","ms":50} and include DONE: <result> in text before JSON.`;
    let turn;
    try { turn = await provider.chat([{role:"user", content: prompt}], []); } catch(e){ return `LLM error: ${(e as Error).message}`; }
    const msg = turn.message || "";
    if (/DONE:/i.test(msg) && !parseAction(msg)) { store.audit("computer.done",{step, msg}); return msg.replace(/.*DONE:\s*/i,"").slice(0,500); }
    const action = parseAction(msg);
    if (!action){ store.audit("computer.no_action",{step}); continue; }
    store.audit("computer.action",{step, type: action.type});
    const res = await execute(action);
    onStep?.(step, action, res.ok, res.message);
    if (!res.ok){ /* continue, let LLM recover */ }
    await new Promise(r=>setTimeout(r, 400));
  }
  return `Computer-use stopped after ${maxSteps} steps without completion.`;
}
