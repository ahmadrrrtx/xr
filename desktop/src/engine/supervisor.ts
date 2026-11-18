/** One boot generation and monotonic budget; cancellation is advisory, so every
 * publisher must also check current(). A normal post-boot poll gets a new budget
 * but not a new engine identity. No token or credentials enter this object. */
import { withinDeadline, RequestDeadlineExpired } from './deadline';
export interface EngineGeneration {
  id: number;
  signal: AbortSignal;
  booted: boolean;
  deadline: number;
}
export function createEngineSupervisor(now = () => performance.now()) {
  let sequence = 0;
  let active: EngineGeneration | null = null;
  let controller: AbortController | null = null;
  return {
    begin(budget: number): EngineGeneration {
      controller?.abort();
      controller = new AbortController();
      active = { id: ++sequence, signal: controller.signal, deadline: now() + budget, booted: false };
      return active;
    },
    cancel() { controller?.abort(); active = null; },
    current(g: EngineGeneration) { return active === g && !g.signal.aborted; },
    scope(g: EngineGeneration, budget: number) {
      const deadline = Math.min(g.booted ? Infinity : g.deadline, now() + budget);
      const current = () => active === g && !g.signal.aborted;
      return {
        current,
        remaining: () => Math.max(0, deadline - now()),
        async run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
          if (!current()) throw new DOMException('Superseded engine generation', 'AbortError');
          const remaining = deadline - now();
          if (remaining <= 0) throw new RequestDeadlineExpired();
          const out = await withinDeadline(operation, remaining, g.signal);
          if (!current()) throw new DOMException('Superseded engine generation', 'AbortError');
          return out;
        },
      };
    },
  };
}
