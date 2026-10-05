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
import type { ApprovalSpec } from '@/lib/approvalCore';
import type { ToolCallRecord } from '@/lib/chat-db';
import { useUIStore } from '@/stores/ui';

export interface ChatTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export type StreamEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; call: ToolCallRecord }
  | {
      type: 'tool_result';
      id: string;
      output: string;
      status: 'done' | 'error';
      /** Phase 12: XR Shield answered before the human could (policy block). */
      blocked?: boolean;
    }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface StreamOptions {
  messages: ChatTurn[];
  model: string;
  signal: AbortSignal;
  onEvent: (e: StreamEvent) => void;
  /**
   * Phase 7: when a script's tool needs permission, the provider parks the
   * stream on this gate until the human decides (approval modal / rules).
   * Surfaces that pass no gate (e.g. the HUD quick-ask) keep the old
   * auto-continue behavior.
   */
  requestApproval?: (
    call: { summary: string },
    spec: ApprovalSpec
  ) => Promise<{ approved: boolean; reason?: string; blocked?: boolean }>;
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
  tool?: Omit<ToolCallRecord, 'id' | 'status'> & {
    output: string;
    /** Present → the tool is blocked until the user approves. */
    approval?: ApprovalSpec;
    /** After-text when the user denies (approved keeps `after`). */
    deniedAfter?: string;
  };
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
  // ── Permission-gated actions (Phase 7) — deterministic keyword matches ──
  const emailAddr =
    p.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? 'sarah@company.com';
  if (/\b(send|write|draft|reply|forward)\b/.test(p) && /\b(email|mail|gmail)\b/.test(p)) {
    return {
      before: "I can send that for you — one thing first:",
      tool: {
        tool: 'gmail',
        summary: `Send email to ${emailAddr}`,
        category: 'approval',
        input: { to: emailAddr, subject: 'Portfolio update' },
        output: `Message sent to ${emailAddr} (gmail id gm-1a2b3c).`,
        approval: {
          skillId: 'gmail-skill',
          skillName: 'gmail-skill',
          skillVersion: 'v1.2',
          skillIcon: 'mail',
          action: 'Send email',
          resource: emailAddr,
          subject: 'Portfolio update',
          bodyPreview: `Hi Sarah,

Here's the portfolio update we discussed — the Q3 numbers are in, and the new deck is attached.

Best,
XR (on behalf of Ahmad)`,
          risk: 'medium',
          justification: 'Ahmad asked to send the portfolio update to Sarah.',
        },
        deniedAfter:
          "No problem — I didn't send anything. Want me to draft it first so you can review, or adjust the message?",
      },
      after: "Done — the email is on its way to **" + emailAddr + "**. Anything else you'd like me to add to the thread?",
    };
  }
  if (/\b(delete|remove|trash)\b/.test(p) && /\bfile|folder|directory\b/.test(p)) {
    return {
      before: "That's a destructive one, so I'll need your sign-off:",
      tool: {
        tool: 'write_file',
        summary: 'Delete ~/projects/old-build',
        category: 'file',
        input: { path: '~/projects/old-build', op: 'rm -rf' },
        output: 'Deleted ~/projects/old-build (412 files, 61 MB).',
        approval: {
          skillId: 'fs-skill',
          skillName: 'fs-skill',
          skillVersion: 'v1.0',
          skillIcon: 'file',
          action: 'Delete a folder',
          resource: '~/projects/old-build',
          bodyPreview: 'rm -rf ~/projects/old-build\n\n412 files · 61 MB · cannot be undone.',
          risk: 'high',
          justification: 'Ahmad asked to delete the old build folder to free space.',
        },
        deniedAfter:
          "Understood — **nothing was deleted**. I can move it to the trash instead so it's recoverable for 30 days, if you want.",
      },
      after: "Deleted **~/projects/old-build** — 61 MB freed. The disk had plenty of headroom anyway.",
    };
  }
  if (/\b(read|open|show|cat)\b/.test(p) && /\b(file|readme|notes?)\b/.test(p) && !/\b(delete|remove|write|save)\b/.test(p)) {
    return {
      before: 'Reading it now:',
      tool: {
        tool: 'read_file',
        summary: 'Read ~/notes/standup.md',
        category: 'file',
        input: { path: '~/notes/standup.md' },
        output: '# Standup\n\n- Shipped the approval modal\n- Orb sync green\n- Next: Shield screen',
        approval: {
          skillId: 'fs-skill',
          skillName: 'fs-skill',
          skillVersion: 'v1.0',
          skillIcon: 'file',
          action: 'Read a file',
          resource: '~/notes/standup.md',
          risk: 'low',
          justification: 'Ahmad asked to read the standup notes. Read-only, inside the workspace.',
        },
        deniedAfter: "Okay — I didn't open it. Tell me which file you'd like instead.",
      },
      after:
        "Here's what's in **~/notes/standup.md**:\n\n- Shipped the approval modal\n- Orb sync green\n- Next: Shield screen",
    };
  }
  if (/\bwrite|save|log\b/.test(p) && /\bfile\b/.test(p) && !/\b(delete|remove)\b/.test(p)) {
    return {
      before: "I'll write that to disk — approving it is on you:",
      tool: {
        tool: 'write_file',
        summary: 'Write ~/notes/standup.md',
        category: 'file',
        input: { path: '~/notes/standup.md', bytes: 412 },
        output: 'Wrote 412 bytes to ~/notes/standup.md.',
        approval: {
          skillId: 'fs-skill',
          skillName: 'fs-skill',
          skillVersion: 'v1.0',
          skillIcon: 'file',
          action: 'Write a file',
          resource: '~/notes/standup.md',
          bodyPreview: '# Standup\n\n- Shipped the approval modal\n- Orb sync green\n- Next: Shield screen',
          risk: 'medium',
          justification: "Ahmad asked to save today's standup notes to a file.",
        },
        deniedAfter: "Okay — I kept it in the chat instead. Copy it whenever you're ready.",
      },
      after: "Saved to **~/notes/standup.md** (412 bytes).",
    };
  }
  if (/\b(shell|terminal|bash|command line|cli command)\b/.test(p)) {
    return {
      before: "This runs a shell command on your machine — review it:",
      tool: {
        tool: 'shell',
        summary: 'Run shell command',
        category: 'shell',
        input: { command: 'brew upgrade && brew cleanup' },
        output: 'Upgraded 14 formulae, cleaned 812 MB.',
        approval: {
          skillId: 'shell-skill',
          skillName: 'shell-skill',
          skillVersion: 'v1.1',
          skillIcon: 'terminal',
          action: 'Run a shell command',
          resource: null,
          bodyPreview: '$ brew upgrade && brew cleanup\n\n(updates every installed Homebrew package)',
          risk: 'high',
          justification: 'Ahmad asked to update the installed packages via the shell.',
        },
        deniedAfter: "Skipped — no commands were run. Want to see exactly what it would have done first?",
      },
      after: "All done — 14 packages upgraded and **812 MB** cleaned. Everything still links cleanly.",
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
      const { approval, deniedAfter, ...rest } = script.tool;
      const call: ToolCallRecord = {
        ...rest,
        id: uid(),
        status: approval ? 'waiting-approval' : 'running',
      };
      opts.onEvent({ type: 'tool_call', call });

      if (approval && opts.requestApproval) {
        // Park the stream until the human (or a remember rule / XR Shield
        // policy) decides.
        const verdict = await opts.requestApproval(call, approval);
        if (!verdict.approved) {
          opts.onEvent({
            type: 'tool_result',
            id: call.id,
            output: verdict.blocked
              ? `${verdict.reason ?? 'Blocked by XR Shield'} — nothing ran.`
              : 'User denied this action — nothing ran.',
            status: 'error',
            blocked: verdict.blocked === true,
          });
          if (verdict.blocked) {
            await emitText(
              "XR Shield blocked that before it reached you — nothing ran. You can change the policy under Shield → Security Settings if you want me to ask next time.",
              opts
            );
          } else if (deniedAfter) {
            await emitText(deniedAfter, opts);
          }
          opts.onEvent({ type: 'done' });
          return;
        }
      }
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
