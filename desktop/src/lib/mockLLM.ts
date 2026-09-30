/*
 * Mock streaming LLM (Phase 4) — simulates a realistic SSE stream so the
 * whole chat UX is exercisable before the real backend (Phase 14).
 *
 * The contract is provider-shaped on purpose:
 *   streamChat({ messages, model, signal, onEvent })
 * Phase 14 swaps this file's body for the real Tauri SSE channel and every
 * caller keeps working. Events:
 *   token      { text }              — append to the streaming buffer
 *   tool_call  { call }              — a tool started (status: running)
 *   tool_result{ id, output, status }— the tool finished
 *   done       {}                    — stream complete
 *   error      { message }           — stream failed
 */
import type { ToolCallRecord } from '@/lib/chat-db';
import { useUIStore } from '@/stores/ui';

export interface ChatTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export type StreamEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; call: ToolCallRecord }
  | { type: 'tool_result'; id: string; output: string; status: 'done' | 'error' }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface StreamOptions {
  messages: ChatTurn[];
  model: string;
  signal: AbortSignal;
  onEvent: (e: StreamEvent) => void;
}

/** Dev-only simulated failure rate (0 in tests). Overridable via
 * localStorage `xr.mock.errorRate` so e2e runs can pin it deterministically
 * (an init-script can set storage before this module loads). */
let errorRate = import.meta.env.DEV ? 0.05 : 0;
try {
  const saved = window.localStorage.getItem('xr.mock.errorRate');
  if (saved !== null && saved !== '' && !Number.isNaN(Number(saved))) {
    errorRate = Number(saved);
  }
} catch {
  /* storage unavailable */
}

export function setMockErrorRate(rate: number): void {
  errorRate = rate;
}

// Dev-only hook so e2e runs can pin the error rate (never shipped in prod).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __xrSetMockErrorRate: (r: number) => void }).__xrSetMockErrorRate =
    setMockErrorRate;
}

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Split text into realistic "tokens" (words + punctuation, not chars). */
function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

class Aborted extends Error {}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Aborted());
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      reject(new Aborted());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Emit tokens at a human 30–60ms cadence with occasional thinking pauses. */
async function emitText(
  text: string,
  opts: StreamOptions,
  startPaused = false,
): Promise<void> {
  if (startPaused) await sleep(500 + Math.random() * 400, opts.signal);
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i++) {
    await sleep(30 + Math.random() * 30, opts.signal);
    opts.onEvent({ type: 'token', text: tokens[i] });
    // Occasional pause after sentence ends — feels human, not fake-fast.
    if (/[.!?]\s*$/.test(tokens[i]) && Math.random() < 0.25) {
      await sleep(180 + Math.random() * 250, opts.signal);
    }
  }
}

interface Script {
  before?: string;
  tool?: Omit<ToolCallRecord, 'id' | 'status'> & { output: string };
  after?: string;
  code?: string;
}

/** Pick a canned response script from the prompt. */
function scriptFor(prompt: string, userName: string): Script {
  const p = prompt.toLowerCase();
  if (/\b(hello|hi|hey|salam|yo)\b/.test(p)) {
    return {
      after: `Hey${userName ? ` ${userName}` : ''}! Good to see you. I'm running locally and ready — what would you like to work on?`,
    };
  }
  if (/\b(code|function|typescript|sort|snippet|example|refactor)\b/.test(p)) {
    return {
      before:
        "Sure — here's a compact, dependency-free implementation. It handles the common edge cases (empty input, stability, mixed types):",
      code: `type Comparator<T> = (a: T, b: T) => number;

export function sortBy<T>(items: readonly T[], compare: Comparator<T>): T[] {
  const out = [...items]; // don't mutate the caller's array
  out.sort((a, b) => compare(a, b));
  return out;
}

// Example: sort users by name, case-insensitive
const users = [{ name: 'Ada' }, { name: 'linus' }, { name: 'Grace' }];
const sorted = sortBy(users, (a, b) => a.name.localeCompare(b.name));
console.log(sorted); // [Ada, Grace, linus]`,
      after:
        "A couple of notes:\n\n- The spread copy keeps the original array intact — safer for React state.\n- `localeCompare` gives you natural, case-insensitive ordering for free.\n- For large arrays where you sort repeatedly, consider memoizing the comparator result.",
    };
  }
  if (/\b(email|gmail|inbox|mail)\b/.test(p)) {
    return {
      before: "Let me check your inbox first — give me a second.",
      tool: {
        tool: 'gmail',
        summary: 'Read 3 emails from Sarah',
        category: 'tool',
        input: { query: 'from:sarah', maxResults: 3 },
        output:
          '1. "Standup moved to 10:30" (2:01 PM)\n2. "Re: API review — looks good" (11:42 AM)\n3. "Design tokens for the chat screen" (9:15 AM)',
      },
      after:
        "You have **3 emails from Sarah**. The urgent one: standup moved to **10:30**. The API review is approved — no blockers from her side. Want me to draft a reply to any of them?",
    };
  }
  if (/\b(research|find|search|look up|topic)\b/.test(p)) {
    return {
      before: "I'll search the web for the latest on that.",
      tool: {
        tool: 'web_search',
        summary: 'Searched the web for recent results',
        category: 'network',
        input: { query: prompt.slice(0, 80), maxResults: 5 },
        output:
          '4 results: 2 overviews, 1 benchmark comparison, 1 critique. Consensus: adoption growing, benchmarks within margin of error between top two options.',
      },
      after:
        "Here's the short version:\n\n1. The two leading options are within **margin of error** on benchmarks — decision should hinge on ergonomics.\n2. Adoption is growing steadily, with the strongest community around option one.\n3. One credible critique worth reading flags the setup cost for small teams.\n\nWant me to go deeper on any of these?",
    };
  }
  return {
    after:
      "Good question. Here's how I'd think about it:\n\n- **Start small** — the smallest version that proves the point.\n- **Measure before optimizing** — assumptions hide in every step you skip.\n- **Keep it reversible** — prefer choices you can undo cheaply.\n\nTell me more about your setup and I'll get specific.",
  };
}

/**
 * Stream a canned, prompt-aware response. Never rejects — cancellation and
 * failure both arrive as events (error) so the store stays in one place.
 */
export async function streamChat(opts: StreamOptions): Promise<void> {
  const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user');
  const prompt = lastUser?.content ?? '';
  const script = scriptFor(prompt, useUIStore.getState().userName);

  try {
    await sleep(250 + Math.random() * 350, opts.signal); // "connect"

    if (Math.random() < errorRate) {
      await sleep(600, opts.signal);
      opts.onEvent({ type: 'error', message: 'Model stream failed (mock 5% dev error rate).' });
      return;
    }

    if (script.before) await emitText(script.before, opts);

    if (script.code) {
      // Guard blank line before the fence — the preceding prose token may
      // not end with a newline (a glued "```ts" doesn't open a fence).
      await emitText('\n\n```ts\n', opts);
      // Stream the code a little faster, line by line — mirrors real behavior.
      for (const line of script.code.split('\n')) {
        await sleep(40 + Math.random() * 40, opts.signal);
        opts.onEvent({ type: 'token', text: line + '\n' });
      }
      // Closing fence on its own line + blank line before the prose.
      await emitText('```\n\n', opts);
    }

    if (script.tool) {
      const call: ToolCallRecord = {
        ...script.tool,
        id: uid(),
        status: 'running',
      };
      opts.onEvent({ type: 'tool_call', call });
      await sleep(900, opts.signal); // tool runs
      opts.onEvent({ type: 'tool_result', id: call.id, output: script.tool.output, status: 'done' });
    }

    if (script.after) await emitText(script.after, opts, Boolean(script.tool));

    opts.onEvent({ type: 'done' });
  } catch (err) {
    if (err instanceof Aborted) return; // cancelled — caller handles state
    opts.onEvent({ type: 'error', message: err instanceof Error ? err.message : 'Stream failed.' });
  }
}
