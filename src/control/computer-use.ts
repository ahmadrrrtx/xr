import type { Provider } from "../core/types.ts";
import type { Store } from "../state/db.ts";
import { captureScreen, cloudVision } from "./vision.ts";
import { execute } from "./executor.ts";
import { ActionSchema, type Action } from "./types.ts";
import { colors as C } from "../interfaces/cli.ts";

export interface ComputerUseOptions {
  provider: Provider;
  store: Store;
  task: string;
  maxSteps?: number;
  onStep?: (step: number, action: Action, ok: boolean, msg: string) => void;
}

function parseAction(text: string): Action | null {
  try {
    const m = text.match(/\{[\s\S]*"type"[\s\S]*\}/);
    if (m) {
      const o = JSON.parse(m[0]);
      const res = ActionSchema.safeParse(o);
      if (res.success) return res.data;
    }
  } catch {}
  return null;
}

export async function runComputerUse(opts: ComputerUseOptions): Promise<string> {
  const { provider, store, task, maxSteps = 20, onStep } = opts;
  console.log(C.dim(`  [vision] starting loop for: ${task}`));

  for (let step = 1; step <= maxSteps; step++) {
    console.log(C.dim(`  [step ${step}/${maxSteps}] observing screen...`));
    const cap = await captureScreen();
    if (!cap.ok || !cap.base64) return `Observation failed: ${cap.message}`;

    const prompt = `You are XR, a Computer Control Agent.
Task: "${task}"

Your goal is to complete the task by sending ONE JSON action at a time.
Observe the provided screenshot.

Available Actions (JSON):
- {"type":"click", "x":number, "y":number, "button":"left"|"right"|"double"}
- {"type":"type", "text":string}
- {"type":"key", "keys":["enter", "tab", "cmd+c", etc]}
- {"type":"scroll", "direction":"down"|"up", "amount":number}
- {"type":"wait_ms", "ms":number}
- {"type":"open", "target":string}
- {"type":"app", "name":string}

If you have finished the task, reply with: DONE: <result summary>
Otherwise, reply with a short rationale and the JSON action.`;

    const response = await cloudVision(provider, prompt, cap.base64);
    
    if (/DONE:/i.test(response)) {
      const result = response.split(/DONE:/i)[1].trim();
      store.audit("control.computer_use.done", { task, step, result });
      return result;
    }

    const action = parseAction(response);
    if (!action) {
      console.log(C.amber(`  [step ${step}] no valid action in LLM response. Retrying observation...`));
      continue;
    }

    console.log(`  ${C.cyan("→")} ${C.bold(action.type)} ${JSON.stringify(action).slice(0, 80)}...`);
    const res = await execute(action);
    onStep?.(step, action, res.ok, res.message);
    
    if (!res.ok) {
      console.log(C.red(`  [step ${step}] action failed: ${res.message}`));
    }

    await new Promise(r => setTimeout(r, 800)); // Pause between steps
  }

  return `Task timed out after ${maxSteps} steps.`;
}
