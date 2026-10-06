/*
 * Mock trace generator + live-run simulator (Phase 9, brief §2).
 *
 * Two jobs, one script shape:
 *   1. `createMockRun(id)` — materialises a deterministic snapshot (Run +
 *      flat Span[]) from a flavour (short/medium/long/error/waiting/stress).
 *   2. `streamMockRun(runId, hooks)` — replays the same script on a real
 *      100ms tick, emitting start/end/token/log/run events, and PAUSES at
 *      the approval span until the caller resolves the Phase 7 decision.
 *
 * Phase 14 swaps this module for a Tauri-event-backed emitter with the same
 * StreamHooks surface — the store never knows which one feeds it.
 *
 * All spans are addressed by offset from the run start on a virtual clock;
 * a seeded RNG (mulberry32) keeps jitter + token counts stable per id so
 * screenshots don't shift between runs.
 */
import type { ApprovalSpec } from '@/lib/approvalCore';

import { hashSeed, rngFrom, type Rng } from './rng';
import type {
  MockFlavor,
  Run,
  Span,
  SpanCategory,
  SpanError,
  StreamHooks,
} from './types';

/* ── Script shape (the source of truth for both snapshot + stream) ───── */

interface ScriptLog {
  at: number; // ms after span start
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
}

export interface ScriptSpan {
  id: string;
  parentId: string | null;
  name: string;
  category: SpanCategory;
  start: number; // ms after run start
  duration: number; // ms
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  inputs?: unknown;
  outputs?: unknown;
  error?: SpanError;
  metadata?: Record<string, unknown>;
  logs?: ScriptLog[];
  /** When set, the stream pauses here until the caller decides. */
  approval?: { spec: ApprovalSpec };
}

export interface MockScript {
  title: string;
  agent: string;
  workspace?: string;
  model: string;
  totalDuration: number;
  spans: ScriptSpan[];
  /** Snapshot materialisation: stop "live" here (waiting flavour). */
  pauseAt?: string; // span id
  /** Snapshot: spans after the pause are `pending`, the pause span `waiting`. */
  endsFailedAt?: string; // span id whose failure kills the run (error flavour)
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

/** 6-char stable slug of the run id → span ids are unique per run, never per suffix. */
function slug(runId: string): string {
  return hashSeed(runId).toString(36).padStart(6, '0').slice(0, 6);
}

/**
 * Approval gate spec per flavour (email for medium/waiting, web for long).
 */
function approvalSpec(): { spec: ApprovalSpec } {
  return {
    spec: {
      skillId: 'email',
      skillName: 'Email',
      skillVersion: '1.4.0',
      skillIcon: 'mail',
      action: 'send draft summary to 4 stakeholders',
      resource: 'stakeholders@acme.co',
      subject: 'Q3 summary + key numbers',
      bodyPreview:
        'Hi all — Q3 closed at 4.9M revenue (+17% since July), churn flat at ~1.1%.\n\nKey items:\n• Pipeline +2.1M qualified\n• Pricing page shipped\n• Watch: infra cost +18%\n\nFull summary attached. — XR',
      risk: 'medium',
      justification:
        'The summarizer subagent drafted a stakeholder email and wants to send it before you review it.',
    },
  };
}

/** gpt-4o-style pricing per 1M tokens. */
const PRICE: Record<string, { in: number; out: number }> = {
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'llama3.1:70b': { in: 0, out: 0 },
  'claude-sonnet': { in: 3, out: 15 },
};

function llmCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICE[model] ?? PRICE['gpt-4o'];
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
}

interface LlmOpts {
  id: string;
  parentId: string | null;
  name: string;
  start: number;
  duration: number;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  inputs?: unknown;
  outputs?: string;
  metadata?: Record<string, unknown>;
}

function llm(o: LlmOpts): ScriptSpan {
  const model = o.model ?? 'gpt-4o';
  const tokensIn = o.tokensIn ?? 1200;
  const tokensOut = o.tokensOut ?? 300;
  return {
    id: o.id,
    parentId: o.parentId,
    name: o.name,
    category: 'llm',
    start: o.start,
    duration: o.duration,
    model,
    tokensIn,
    tokensOut,
    costUsd: o.costUsd ?? llmCost(model, tokensIn, tokensOut),
    inputs: o.inputs,
    outputs: o.outputs,
    metadata: { endpoint: 'chat.completions', stream: true, ...o.metadata },
  };
}

/* ── The medium script (brief §2 canonical example, + color variety) ─── */

function mediumScript(
  rng: Rng,
  runId: string,
  approval: { spec: ApprovalSpec }
): MockScript {
  const R = (n: number): number => Math.floor(rng() * n);
  const s = (
    n: number,
    id: string,
    parentId: string | null,
    name: string,
    category: SpanCategory,
    duration: number,
    extra: Partial<ScriptSpan> = {}
  ): ScriptSpan => ({
    id,
    parentId,
    name,
    category,
    start: n,
    duration,
    ...extra,
  });

  const id = (k: string): string => `sp_${slug(runId)}_${k}`;

  const spans: ScriptSpan[] = [
    s(0, id('root'), null, 'run', 'agent', 27_400, {
      inputs: { agent: 'Main', entry: 'chat' },
      outputs: undefined,
    }),
    s(0, id('user'), id('root'), 'Summarize Q3 reports', 'user', 1, {
      inputs:
        'Summarize the Q3 reports in ./reports and draft a stakeholder email.',
      outputs: undefined,
    }),
    llm({
      id: id('plan'),
      parentId: id('root'),
      name: 'plan',
      start: 140,
      duration: 4_000,
      tokensIn: 2_812,
      tokensOut: 486,
      inputs: {
        system:
          'You are XR — plan the minimal set of tool calls, then execute.',
        user: 'Summarize the Q3 reports in ./reports and draft a stakeholder email.',
      },
      outputs:
        'Plan: (1) list ./reports, (2) read each Q3 file, (3) summarise per month via the summarizer subagent, (4) synthesise a final summary, (5) write summary.md, (6) draft the email behind an approval gate.',
    }),
    s(4_200, id('readdir'), id('root'), 'fs.readDir', 'file', 12, {
      inputs: { path: './reports' },
      outputs: {
        entries: ['q3-july.md', 'q3-aug.md', 'q3-sep.md', 'q2-archived.md'],
      },
      metadata: { path: './reports', entries: 4 },
    }),
    llm({
      id: id('parse'),
      parentId: id('readdir'),
      name: 'parse-filenames',
      start: 4_300,
      duration: 800,
      model: 'gpt-4o-mini',
      tokensIn: 214,
      tokensOut: 92,
      inputs: {
        entries: ['q3-july.md', 'q3-aug.md', 'q3-sep.md', 'q2-archived.md'],
      },
      outputs:
        'Q3 files: q3-july.md, q3-aug.md, q3-sep.md (q2-archived.md excluded)',
    }),
    s(5_200, id('read1'), id('root'), 'fs.readFile', 'file', 48, {
      inputs: { path: './reports/q3-july.md' },
      outputs: {
        bytes: 18_412,
        preview: '# Q3 — July\nRevenue 4.2M (+8% MoM)…',
      },
      metadata: { path: './reports/q3-july.md', bytes: 18_412 },
      logs: [
        { at: 2, stream: 'stdout', text: 'open ./reports/q3-july.md' },
        { at: 44, stream: 'stdout', text: 'read 18412 bytes (0.03s)' },
      ],
    }),
    s(5_300, id('read2'), id('root'), 'fs.readFile', 'file', 51, {
      inputs: { path: './reports/q3-aug.md' },
      outputs: {
        bytes: 21_077,
        preview: '# Q3 — August\nRevenue 4.6M (+9% MoM)…',
      },
      metadata: { path: './reports/q3-aug.md', bytes: 21_077 },
      logs: [
        { at: 2, stream: 'stdout', text: 'open ./reports/q3-aug.md' },
        { at: 47, stream: 'stdout', text: 'read 21077 bytes (0.03s)' },
      ],
    }),
    s(5_400, id('read3'), id('root'), 'fs.readFile', 'file', 47, {
      inputs: { path: './reports/q3-sep.md' },
      outputs: {
        bytes: 19_883,
        preview: '# Q3 — September\nRevenue 4.9M (+7% MoM)…',
      },
      metadata: { path: './reports/q3-sep.md', bytes: 19_883 },
      logs: [
        { at: 2, stream: 'stdout', text: 'open ./reports/q3-sep.md' },
        { at: 43, stream: 'stdout', text: 'read 19883 bytes (0.03s)' },
      ],
    }),
    s(5_650, id('net1'), id('root'), 'http.fetch', 'network', 340, {
      inputs: { url: 'https://api.xr.local/v1/benchmarks?q3', method: 'GET' },
      outputs: { status: 200, contentType: 'application/json', bytes: 2_048 },
      metadata: {
        url: 'https://api.xr.local/v1/benchmarks?q3',
        status: 200,
        contentType: 'application/json',
      },
      logs: [
        { at: 1, stream: 'stdout', text: 'GET /v1/benchmarks?q3' },
        { at: 332, stream: 'stdout', text: '200 OK · 2048 bytes · 332ms' },
      ],
    }),
    s(6_050, id('shell1'), id('root'), 'shell.exec', 'shell', 38, {
      inputs: { command: 'ls -la reports/', cwd: '/home/user/work/acme' },
      outputs: {
        exit: 0,
        stdout:
          'total 84\ndrwxr-xr-x  6 user staff   192 Sep 30 18:02 .\n-rw-r--r--  1 user staff 18412 Sep 30 17:58 q3-july.md',
      },
      metadata: {
        command: 'ls -la reports/',
        cwd: '/home/user/work/acme',
        exit: 0,
      },
      logs: [
        { at: 1, stream: 'stdout', text: '$ ls -la reports/' },
        { at: 20, stream: 'stdout', text: 'total 84' },
        {
          at: 22,
          stream: 'stdout',
          text: 'drwxr-xr-x  6 user staff   192 Sep 30 18:02 .',
        },
        {
          at: 24,
          stream: 'stdout',
          text: '-rw-r--r--  1 user staff 18412 Sep 30 17:58 q3-july.md',
        },
        { at: 36, stream: 'stdout', text: 'exit 0' },
      ],
    }),
    s(6_500, id('sub'), id('root'), 'summarizer', 'subagent', 13_400, {
      inputs: {
        prompt:
          'Summarise each monthly report to 5 bullets, then draft a 1-paragraph quarter view.',
      },
      outputs:
        'Quarter view: revenue grew 17% July→September; churn flat; two launch risks logged.',
      metadata: { agent: 'Summarizer', temperature: 0.2 },
    }),
    llm({
      id: id('sum1'),
      parentId: id('sub'),
      name: 'summarize: july',
      start: 6_600,
      duration: 3_400,
      tokensIn: 3_120,
      tokensOut: 410,
      inputs: { text: '# Q3 — July … (18412 bytes)' },
      outputs:
        '- Revenue 4.2M, +8% MoM\n- Two enterprise deals closed\n- Churn 1.1%, flat\n- Support load up 6%\n- Risk: pricing page bug (fixed 7/29)',
    }),
    llm({
      id: id('sum2'),
      parentId: id('sub'),
      name: 'summarize: aug',
      start: 10_200,
      duration: 3_100,
      tokensIn: 3_240,
      tokensOut: 388,
      inputs: { text: '# Q3 — August … (21077 bytes)' },
      outputs:
        '- Revenue 4.6M, +9% MoM\n- EU expansion kicked off\n- 3 new seats in 2 large accounts\n- Incident: 22min API outage (8/14)\n- Hiring: 2 AEs joined',
    }),
    llm({
      id: id('sum3'),
      parentId: id('sub'),
      name: 'summarize: sep',
      start: 13_500,
      duration: 3_600,
      tokensIn: 3_310,
      tokensOut: 402,
      inputs: { text: '# Q3 — September … (19883 bytes)' },
      outputs:
        '- Revenue 4.9M, +7% MoM\n- QBR pipeline +2.1M qualified\n- Pricing page shipped\n- Onboarding NPS 61 (+9)\n- Risk: infra cost up 18%',
    }),
    s(17_200, id('appr'), id('sub'), 'approval.request', 'approval', 12_000, {
      inputs: {
        skill: 'email',
        action: 'send draft summary to 4 stakeholders',
        resource: 'stakeholders@acme.co',
      },
      outputs: { decision: 'approved', rule: null },
      metadata: { skill: 'email', risk: 'medium' },
      approval: { spec: approval.spec },
      logs: [
        {
          at: 2,
          stream: 'system',
          text: 'approval gate: email.send → stakeholders@acme.co (medium risk)',
        },
      ],
    }),
    llm({
      id: id('synth'),
      parentId: id('root'),
      name: 'synthesize final',
      start: 20_000,
      duration: 5_200,
      tokensIn: 7_480,
      tokensOut: 1_120,
      costUsd: 0.041,
      inputs: { parts: ['july summary', 'aug summary', 'sep summary'] },
      outputs:
        '**Q3 in one paragraph.** Revenue climbed from 4.2M to 4.9M (+17%) with churn held at ~1.1%. ' +
        'The EU launch and the pricing-page ship drove the second half; the 8/14 outage and rising ' +
        'infra cost are the two items to carry into Q4.\n\n## Highlights\n- Pipeline +2.1M qualified\n- NPS 61\n- 2 enterprise deals',
    }),
    s(25_400, id('write'), id('root'), 'fs.writeFile', 'file', 32, {
      inputs: { path: './reports/summary.md', bytes: 2_144 },
      outputs: { path: './reports/summary.md', bytes: 2_144 },
      metadata: { path: './reports/summary.md', bytes: 2_144 },
      logs: [
        {
          at: 1,
          stream: 'stdout',
          text: 'write ./reports/summary.md (2144 bytes)',
        },
        { at: 30, stream: 'stdout', text: 'ok' },
      ],
    }),
    llm({
      id: id('final'),
      parentId: id('root'),
      name: 'final response',
      start: 25_700,
      duration: 1_700,
      tokensIn: 1_980,
      tokensOut: 264,
      inputs: { context: 'summary.md written; email drafted' },
      outputs:
        'Done. Wrote `reports/summary.md` and staged the stakeholder email for your review.\n\n' +
        'Q3 revenue grew 17% (4.2M → 4.9M) with churn flat at ~1.1%. Watch items: infra cost +18% and the 8/14 outage postmortem.',
    }),
  ];

  // Deterministic jitter (±30ms) so bars are not machine-perfect, per-seed.
  for (const sp of spans) {
    if (sp.id !== id('root') && sp.category !== 'user' && !sp.approval) {
      sp.start += R(31);
    }
  }
  return {
    title: 'Summarize Q3 reports',
    agent: 'Main',
    workspace: 'acme',
    model: 'gpt-4o',
    totalDuration: 27_400,
    spans,
  };
}

/* ── Other flavours ───────────────────────────────────────────────────── */

function shortScript(runId: string): MockScript {
  const id = (k: string): string => `sp_${slug(runId)}_${k}`;
  return {
    title: 'Quick question: best way to log spans',
    agent: 'Main',
    model: 'gpt-4o-mini',
    totalDuration: 4_600,
    spans: [
      {
        id: id('root'),
        parentId: null,
        name: 'run',
        category: 'agent',
        start: 0,
        duration: 4_600,
        inputs: { agent: 'Main', entry: 'quick-ask' },
      },
      {
        id: id('user'),
        parentId: id('root'),
        name: 'best way to log spans?',
        category: 'user',
        start: 0,
        duration: 1,
        inputs: 'What is the best way to log agent spans locally?',
      },
      llm({
        id: id('plan'),
        parentId: id('root'),
        name: 'plan',
        start: 120,
        duration: 1_200,
        model: 'gpt-4o-mini',
        tokensIn: 420,
        tokensOut: 96,
        outputs: 'Answer directly; no tools needed.',
      }),
      {
        id: id('tool1'),
        parentId: id('root'),
        name: 'web.search',
        category: 'tool',
        start: 1_500,
        duration: 420,
        inputs: { query: 'open telemetry span logging local-first' },
        outputs: { results: 5, top: 'OTel SDK in-process exporter (5ms p50)' },
        metadata: { query: 'open telemetry span logging local-first' },
      },
      llm({
        id: id('final'),
        parentId: id('root'),
        name: 'final response',
        start: 2_000,
        duration: 2_500,
        model: 'gpt-4o-mini',
        tokensIn: 980,
        tokensOut: 210,
        outputs:
          'Use an in-process OTel exporter: spans land in a local ring buffer, then the Brain view renders them. p50 overhead is ~5ms per span, so you can log every call without a measurable cost.',
      }),
    ],
  };
}

function longScript(
  rng: Rng,
  runId: string,
  approval: { spec: ApprovalSpec }
): MockScript {
  const id = (k: string): string => `sp_${slug(runId)}_${k}`;
  const R = (n: number): number => Math.floor(rng() * n);
  const sources = [
    'https://blog.acme.co/q3-engineering-review',
    'https://metrics.io/reports/q3-churn',
    'https://docs.xr.dev/guides/trust-plane',
    'https://news.dev/ai-agents-q3-market',
    'https://bench.run/llama3-70b-eval',
    'https://finance.example/acme-q3-earnings',
  ];
  const spans: ScriptSpan[] = [
    {
      id: id('root'),
      parentId: null,
      name: 'run',
      category: 'agent',
      start: 0,
      duration: 90_000,
      inputs: { agent: 'Research', entry: 'research' },
    },
    {
      id: id('user'),
      parentId: id('root'),
      name: 'Research Q3: agentic AI trust',
      category: 'user',
      start: 0,
      duration: 1,
      inputs:
        'Deep research: how do teams keep trust with agentic AI in Q3 2026? Standard depth.',
    },
    llm({
      id: id('plan'),
      parentId: id('root'),
      name: 'plan',
      start: 200,
      duration: 3_800,
      tokensIn: 2_400,
      tokensOut: 520,
      outputs:
        'Search 3 queries, fetch top 6 sources, read each via the reader subagent, synthesise with citations.',
    }),
    {
      id: id('search1'),
      parentId: id('root'),
      name: 'web.search',
      category: 'tool',
      start: 4_100,
      duration: 640,
      inputs: { query: 'agentic AI trust 2026' },
      outputs: { results: 8 },
    },
    {
      id: id('search2'),
      parentId: id('root'),
      name: 'web.search',
      category: 'tool',
      start: 4_900,
      duration: 580,
      inputs: { query: 'open telemetry agent audit' },
      outputs: { results: 6 },
    },
  ];
  let t = 6_200;
  sources.forEach((url, i) => {
    spans.push({
      id: id(`fetch${i}`),
      parentId: id('root'),
      name: 'http.fetch',
      category: 'network',
      start: t,
      duration: 420 + R(300),
      inputs: { url, method: 'GET' },
      outputs: {
        status: 200,
        contentType: 'text/html',
        bytes: 38_000 + R(40_000),
      },
      metadata: { url, status: 200, contentType: 'text/html' },
      logs: [
        { at: 2, stream: 'stdout', text: `GET ${url}` },
        { at: 400, stream: 'stdout', text: `200 OK · ${38 + R(40)}kb` },
      ],
    });
    t += 150 + R(120);
  });
  t += 600;
  spans.push({
    id: id('reader'),
    parentId: id('root'),
    name: 'reader',
    category: 'subagent',
    start: t,
    duration: 44_000,
    inputs: {
      prompt:
        'Read each source, extract 3 claims with confidence, flag contradictions.',
    },
  });
  sources.forEach((url, i) => {
    const st = t + 400 + i * 7_000;
    spans.push(
      llm({
        id: id(`read${i}`),
        parentId: id('reader'),
        name: `read: ${new URL(url).hostname}`,
        start: st,
        duration: 6_200,
        tokensIn: 8_200 + R(900),
        tokensOut: 640,
        inputs: { url },
        outputs: `- Claim: trust requires per-call audit (0.9)\n- Claim: OTel-style traces cut incident time 40% (0.7)\n- Flag: source 2 and 5 disagree on churn baseline`,
      })
    );
  });
  t += 45_000;
  spans.push(
    {
      id: id('appr'),
      parentId: id('root'),
      name: 'approval.request',
      category: 'approval',
      start: t,
      duration: 9_000,
      inputs: {
        skill: 'web',
        action: 'open 6 external links in the report',
        resource: sources[0],
      },
      outputs: { decision: 'approved', rule: null },
      metadata: { skill: 'web', risk: 'low' },
      approval: { spec: approval.spec },
      logs: [
        {
          at: 2,
          stream: 'system',
          text: 'approval gate: web.open × 6 (low risk)',
        },
      ],
    },
    llm({
      id: id('cite'),
      parentId: id('root'),
      name: 'cite + resolve contradictions',
      start: t + 9_600,
      duration: 4_200,
      tokensIn: 12_400,
      tokensOut: 860,
      outputs:
        'Citations [1]–[6] assigned; contradiction on churn baseline flagged with both sources.',
    })
  );
  t += 14_400;
  spans.push(
    llm({
      id: id('report'),
      parentId: id('root'),
      name: 'synthesize report',
      start: t,
      duration: 8_600,
      tokensIn: 18_900,
      tokensOut: 2_900,
      outputs:
        '## Q3 agentic AI trust\nSix sources, three load-bearing claims… (full markdown, 2900 tokens)',
    }),
    {
      id: id('write'),
      parentId: id('root'),
      name: 'fs.writeFile',
      category: 'file',
      start: t + 8_800,
      duration: 41,
      inputs: { path: './research/q3-ai-trust.md', bytes: 14_200 },
      outputs: { path: './research/q3-ai-trust.md', bytes: 14_200 },
      metadata: { path: './research/q3-ai-trust.md', bytes: 14_200 },
    }
  );
  t += 9_400;
  spans.push(
    llm({
      id: id('final'),
      parentId: id('root'),
      name: 'final response',
      start: t,
      duration: 2_400,
      tokensIn: 3_100,
      tokensOut: 380,
      outputs:
        'Report saved to research/q3-ai-trust.md — 6 sources, 1 flagged contradiction, 3 claims with confidence scores.',
    })
  );
  const total = t + 2_400;
  spans[0].duration = total;
  return {
    title: 'Research: agentic AI trust in Q3',
    agent: 'Research',
    workspace: 'research',
    model: 'gpt-4o',
    totalDuration: total,
    spans,
  };
}

function errorScript(runId: string): MockScript {
  const id = (k: string): string => `sp_${slug(runId)}_${k}`;
  return {
    title: 'Deploy staging build',
    agent: 'Coder',
    workspace: 'acme',
    model: 'gpt-4o',
    totalDuration: 9_600,
    // The run is marked failed when the recovery attempt itself gives up,
    // so both the shell error AND the agent's abort are visible in the trace.
    endsFailedAt: id('recovery'),
    spans: [
      {
        id: id('root'),
        parentId: null,
        name: 'run',
        category: 'agent',
        start: 0,
        duration: 9_600,
        inputs: { agent: 'Coder', entry: 'chat' },
      },
      {
        id: id('user'),
        parentId: id('root'),
        name: 'Deploy staging build',
        category: 'user',
        start: 0,
        duration: 1,
        inputs: 'Build and deploy the staging bundle.',
      },
      llm({
        id: id('plan'),
        parentId: id('root'),
        name: 'plan',
        start: 150,
        duration: 2_600,
        tokensIn: 1_980,
        tokensOut: 240,
        outputs: 'Run bun build, then deploy via the xr-cli staging target.',
      }),
      {
        id: id('write'),
        parentId: id('root'),
        name: 'fs.writeFile',
        category: 'file',
        start: 2_900,
        duration: 28,
        inputs: { path: './dist/staging.tar', bytes: 4_210_000 },
        outputs: { path: './dist/staging.tar', bytes: 4_210_000 },
        metadata: { path: './dist/staging.tar', bytes: 4_210_000 },
      },
      {
        id: id('shell1'),
        parentId: id('root'),
        name: 'shell.exec',
        category: 'shell',
        start: 3_200,
        duration: 1_900,
        inputs: {
          command: 'bun build --target staging',
          cwd: '/home/user/work/acme',
        },
        outputs: { exit: 127, stderr: 'sh: line 1: bun: command not found' },
        error: {
          name: 'ShellError',
          message: 'exit code 127 — bun: command not found',
          stack:
            'ShellError: exit code 127\n    at spawnAndWait (agent/runtime/shell.ts:142:11)\n    at Skill.exec (agent/runtime/skills.ts:88:20)\n    at RunStep.execute (agent/runtime/run.ts:231:18)',
        },
        metadata: {
          command: 'bun build --target staging',
          cwd: '/home/user/work/acme',
          exit: 127,
        },
        logs: [
          { at: 1, stream: 'stdout', text: '$ bun build --target staging' },
          {
            at: 40,
            stream: 'stderr',
            text: 'sh: line 1: bun: command not found',
          },
          { at: 42, stream: 'stderr', text: 'exit 127' },
        ],
      },
      {
        id: id('recovery'),
        parentId: id('root'),
        name: 'llm.recover',
        category: 'llm',
        start: 5_300,
        duration: 3_200,
        model: 'gpt-4o',
        tokensIn: 2_410,
        tokensOut: 310,
        inputs: { error: 'ShellError: exit code 127 — bun: command not found' },
        outputs:
          'Cannot recover: the toolchain is missing in this shell. Stopping the run and surfacing the error.',
        error: {
          name: 'RunAborted',
          message:
            'Agent aborted: unrecoverable tool failure (bun missing from PATH)',
          stack:
            'RunAborted: Agent aborted: unrecoverable tool failure (bun missing from PATH)\n    at RunStep.execute (agent/runtime/run.ts:244:9)',
        },
        metadata: { endpoint: 'chat.completions', aborted: true },
      },
    ],
  };
}

/** 10,000-node stress run (250 iterations × 40 spans), all completed, ~30s. */
function stressScript(runId: string): MockScript {
  const id = (k: string): string => `sp_${slug(runId)}_${k}`;
  const spans: ScriptSpan[] = [
    {
      id: id('root'),
      parentId: null,
      name: 'run',
      category: 'agent',
      start: 0,
      duration: 30_000,
      inputs: { agent: 'Main', entry: 'stress' },
    },
    {
      id: id('user'),
      parentId: id('root'),
      name: 'stress: ingest 10k events',
      category: 'user',
      start: 0,
      duration: 1,
      inputs: 'Stress test: generate a 10,000-span trace.',
    },
  ];
  const perIter = 120; // ms
  for (let i = 0; i < 250; i++) {
    const t0 = i * perIter;
    const planId = id(`p${i}`);
    spans.push(
      llm({
        id: planId,
        parentId: id('root'),
        name: `plan step ${i}`,
        start: t0,
        duration: 55,
        model: 'gpt-4o-mini',
        tokensIn: 240,
        tokensOut: 60,
        outputs: `chunk ${i} ready`,
      })
    );
    for (let j = 0; j < 39; j++) {
      spans.push({
        id: id(`t${i}_${j}`),
        parentId: planId,
        name: `fs.readChunk ${i}:${j}`,
        category: 'file',
        start: t0 + 60 + j * 1.3,
        duration: 1 + (j % 4),
        inputs: { chunk: i * 39 + j },
        outputs: { bytes: 256 + (j % 7) * 64 },
        metadata: { chunk: i * 39 + j },
      });
    }
  }
  spans.push(
    llm({
      id: id('final'),
      parentId: id('root'),
      name: 'final response',
      start: 250 * perIter + 40,
      duration: 800,
      tokensIn: 1_200,
      tokensOut: 140,
      outputs: 'Ingested 10,000 spans, all accounted for.',
    })
  );
  const total = 250 * perIter + 1_000;
  spans[0].duration = total;
  return {
    title: 'Stress: 10,000-span ingest',
    agent: 'Main',
    model: 'gpt-4o-mini',
    totalDuration: total,
    spans,
  };
}

/* ── Flavour routing ──────────────────────────────────────────────────── */

export function flavorFromId(runId: string): MockFlavor {
  const s = runId.toLowerCase();
  if (s.includes('-stress')) return 'stress';
  if (s.includes('-error')) return 'error';
  if (s.includes('-waiting')) return 'waiting';
  if (s.includes('-short')) return 'short';
  if (s.includes('-long')) return 'long';
  if (s.includes('-medium')) return 'medium';
  if (s.includes('-latest')) return 'latest';
  // Unknown ids get a deterministic medium so /brain/:anyId always renders.
  return 'medium';
}

export function buildScript(flavor: MockFlavor, runId: string): MockScript {
  const rng = rngFrom(runId + ':' + flavor);
  let script: MockScript;
  switch (flavor) {
    case 'short':
      script = shortScript(runId);
      break;
    case 'long':
      script = longScript(rng, runId, approvalSpec());
      break;
    case 'error':
      script = errorScript(runId);
      break;
    case 'stress':
      script = stressScript(runId);
      break;
    case 'waiting':
      script = {
        ...mediumScript(rng, runId, approvalSpec()),
        pauseAt: `sp_${slug(runId)}_appr`,
      };
      break;
    case 'medium':
    case 'latest':
    default:
      script = mediumScript(rng, runId, approvalSpec());
      break;
  }
  // Jitter can push the last span past the nominal total — keep both in sync
  // so the run never completes before its spans do.
  const end = Math.max(...script.spans.map((s) => s.start + s.duration));
  script.totalDuration = Math.max(script.totalDuration, end);
  if (script.spans[0]) script.spans[0].duration = script.totalDuration;
  return script;
}

/* ── Materialisation (snapshot) ───────────────────────────────────────── */

export interface Materialized {
  run: Run;
  spans: Record<string, Span>;
  childrenByParent: Record<string, string[]>;
  /** true when the run is frozen (no stream), false when paused at approval */
  frozen: boolean;
}

/**
 * Materialise a run into full Span objects.
 * `asOf` — virtual playhead: spans that haven't started are `pending`.
 * Pass `Infinity` for a completed snapshot.
 */
export function materialize(
  runId: string,
  flavor: MockFlavor,
  startedAt: number,
  asOf: number,
  now: number
): Materialized {
  const script = buildScript(flavor, runId);
  const rootId = script.spans[0].id;
  const spans: Record<string, Span> = {};
  const childrenByParent: Record<string, string[]> = {};
  for (const sp of script.spans) {
    if (sp.parentId) {
      (childrenByParent[sp.parentId] ??= []).push(sp.id);
    }
  }
  let tokensIn = 0;
  let tokensOut = 0;
  let cost = 0;

  for (const sp of script.spans) {
    const start = startedAt + sp.start;
    const end = start + sp.duration;
    let status: Span['status'];
    let endedAt: number | null;
    let durationMs: number | null;
    if (asOf >= end) {
      status = sp.error ? 'failed' : 'completed';
      endedAt = end;
      durationMs = sp.duration;
    } else if (asOf >= start) {
      status = sp.approval ? 'waiting' : 'running';
      endedAt = null;
      durationMs = asOf - start;
    } else {
      status = 'pending';
      endedAt = null;
      durationMs = null;
    }
    if (sp.tokensIn) tokensIn += sp.tokensIn;
    if (sp.tokensOut) tokensOut += sp.tokensOut;
    if (sp.costUsd) cost += sp.costUsd;
    spans[sp.id] = {
      id: sp.id,
      parentId: sp.parentId,
      name: sp.name,
      category: sp.category,
      status,
      startedAt: start,
      endedAt,
      durationMs,
      tokensIn: sp.tokensIn,
      tokensOut: sp.tokensOut,
      costUsd: sp.costUsd,
      model: sp.model,
      inputs: sp.inputs,
      outputs: sp.outputs,
      error: sp.error,
      metadata: sp.metadata,
    };
  }

  // Run status derives from the script + playhead.
  let status: Run['status'];
  let endedAt: number | null = null;
  const failSpan = script.endsFailedAt ? spans[script.endsFailedAt] : undefined;
  if (
    failSpan &&
    (failSpan.status === 'failed' || failSpan.status === 'running')
  ) {
    // Error flavour: the run stays "running" until the failing span has run
    // its full duration, then the whole run is failed.
    status = failSpan.status === 'failed' ? 'failed' : 'running';
    if (failSpan.status === 'failed') endedAt = failSpan.endedAt ?? now;
  } else if (script.pauseAt) {
    const p = spans[script.pauseAt];
    status =
      p.status === 'waiting'
        ? 'waiting'
        : asOf >= script.totalDuration
          ? 'completed'
          : 'running';
    if (status === 'completed') endedAt = startedAt + script.totalDuration;
  } else {
    status = asOf >= script.totalDuration ? 'completed' : 'running';
    if (status === 'completed') endedAt = startedAt + script.totalDuration;
  }

  const run: Run = {
    id: runId,
    shortId: `#${runId.replace(/\D/g, '').slice(-3) || '847'}`,
    title: script.title,
    agent: script.agent,
    workspace: script.workspace,
    model: script.model,
    status,
    startedAt,
    endedAt,
    tokensIn,
    tokensOut,
    costUsd: cost,
    rootSpanId: rootId,
  };
  return {
    run,
    spans,
    childrenByParent,
    frozen: status === 'completed' || status === 'failed',
  };
}

/* ── Live stream ──────────────────────────────────────────────────────── */

export interface StreamHandle {
  /** Resolve (or deny) the pending approval gate; resumes the playhead. */
  resolveApproval: (approved: boolean) => void;
  /** Kill: all running spans → killed, run → killed. */
  stop: () => void;
  /** True while the playhead is parked at an approval gate. */
  isWaitingApproval: () => boolean;
  /** Phase 13: true while parked on the budget governor's answer. */
  isWaitingBudget: () => boolean;
}

interface RunningSpan extends ScriptSpan {
  startedEmitted: boolean;
  endedEmitted: boolean;
  tokenAcc: number;
  logIdx: number;
  /** Phase 13: the governor answered for this LLM span. */
  gated?: boolean;
  /** Absolute stop for this span's running cost (null = no hard cap). */
  hardRemaining?: number | null;
  /** Running cost already handed to the governor (partial records on stop). */
  recorded?: boolean;
}

/**
 * Phase 13 budget seam. The mock never imports the governor; the store
 * passes `budgetGate` / `recordSpend` from budget/enforce.ts. Every LLM span
 * asks before it starts and reports what it actually cost when it ends.
 */
export interface BudgetHooks {
  gate: (req: BudgetGateRequest) => Promise<BudgetVerdict>;
  record: (input: BudgetSpendInput) => void;
}

export interface BudgetGateRequest {
  model: string;
  estimatedTokensIn: number;
  estimatedTokensOut: number;
  estimatedCost: number;
  agent: string;
  workspace: string | null;
  sessionId: string;
}

export interface BudgetVerdict {
  allowed: boolean;
  reason: string | null;
  /** The model to run with (may be a cheaper downshift). */
  model: string;
  downgradedToModel: string | null;
  downshiftWhy: string | null;
  estimatedCost: number;
  hardRemaining: number | null;
}

export interface BudgetSpendInput {
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  agent: string;
  workspace: string | null;
  sessionId: string;
  partial: boolean;
}

const TICK_MS = 100;

export interface StreamOptions {
  startedAt: number;
  /** Playback speed (2 = twice as fast). Demo runs use ~1. */
  speed?: number;
  /**
   * Virtual playhead at stream start (ms after run start). Spans that
   * finished BEFORE this offset are treated as preloaded: no events fire
   * for them (the store already materialised them — `waiting` flavour).
   */
  fromPlayhead?: number;
  /** Phase 13: ask the budget governor before each LLM span (optional seam). */
  budget?: BudgetHooks;
}

const BUDGET_EPS = 0.0001;

export function streamMockRun(
  runId: string,
  hooks: StreamHooks,
  opts: StreamOptions
): StreamHandle {
  const flavor = flavorFromId(runId);
  const script = buildScript(flavor, runId);
  const speed = opts.speed ?? 1;
  const startedAt = opts.startedAt;
  let playhead = opts.fromPlayhead ?? 0;
  let stopped = false;
  let parkedAt: string | null = null;
  /** Span id waiting on the budget governor (Phase 13). */
  let gatingAt: string | null = null;
  const budget = opts.budget;

  const running = new Map<string, RunningSpan>();
  for (const sp of script.spans) {
    const rs: RunningSpan = {
      ...sp,
      startedEmitted: false,
      endedEmitted: false,
      tokenAcc: 0,
      logIdx: 0,
    };
    // Preloaded spans: mark them done silently.
    if (sp.start + sp.duration <= playhead) {
      rs.startedEmitted = true;
      rs.endedEmitted = true;
      rs.tokenAcc = sp.tokensOut ?? 0;
      rs.logIdx = sp.logs?.length ?? 0;
    }
    running.set(sp.id, rs);
  }

  hooks.onRunStart({
    id: runId,
    shortId: `#${runId.replace(/\D/g, '').slice(-3) || '847'}`,
    title: script.title,
    agent: script.agent,
    workspace: script.workspace,
    model: script.model,
    status: 'running',
    startedAt,
    endedAt: null,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    rootSpanId: script.spans[0].id,
  });

  const failSpanId = script.endsFailedAt;

  /** Phase 13: hand the governor what an LLM span actually cost. */
  function recordSpan(rs: RunningSpan, partial: boolean) {
    if (!budget || rs.category !== 'llm' || rs.recorded || !rs.startedEmitted)
      return;
    rs.recorded = true;
    const tokensOut = partial ? rs.tokenAcc : (rs.tokensOut ?? rs.tokenAcc);
    const full = rs.costUsd ?? 0;
    const cost =
      partial && rs.tokensOut ? (full * rs.tokenAcc) / rs.tokensOut : full;
    budget.record({
      model: rs.model ?? script.model,
      tokensIn: rs.tokensIn ?? 0,
      tokensOut,
      costUsd: Math.round(cost * 1e6) / 1e6,
      agent: script.agent,
      workspace: script.workspace ?? null,
      sessionId: runId,
      partial,
    });
  }

  function finishSpan(
    rs: RunningSpan,
    status: Span['status'],
    error?: Span['error']
  ) {
    rs.endedEmitted = true;
    const endOffset = rs.start + rs.duration;
    hooks.onSpanEnd(rs.id, {
      status,
      endedAt: startedAt + endOffset,
      durationMs: rs.duration,
      outputs: status === 'failed' && !rs.error ? undefined : rs.outputs,
      error,
    });
    recordSpan(rs, false);
  }

  /** Phase 13: the governor said no — fail the span, pend the rest, end the run. */
  function budgetStop(rs: RunningSpan, reason: string, partial: boolean) {
    if (stopped) return;
    if (!rs.startedEmitted) {
      rs.startedEmitted = true;
      hooks.onSpanStart({
        id: rs.id,
        parentId: rs.parentId,
        name: rs.name,
        category: rs.category,
        status: 'running',
        startedAt: startedAt + playhead,
        endedAt: null,
        durationMs: 0,
        model: rs.model,
        inputs: rs.inputs,
        metadata: rs.metadata,
        tokensIn: rs.tokensIn,
        costUsd: 0,
      });
    }
    rs.endedEmitted = true;
    hooks.onSpanEnd(rs.id, {
      status: 'failed',
      endedAt: startedAt + playhead,
      durationMs: Math.max(0, playhead - rs.start),
      error: { name: 'BudgetLimit', message: reason },
    });
    if (partial) recordSpan(rs, true);
    hooks.onLog(rs.id, 'system', `budget: ${reason}`);
    for (const other of running.values()) {
      if (other.id === rs.id || other.endedEmitted) continue;
      if (!other.startedEmitted) {
        other.startedEmitted = true;
        other.endedEmitted = true;
        hooks.onSpanEnd(other.id, { status: 'pending' });
      } else {
        other.endedEmitted = true;
        hooks.onSpanEnd(other.id, {
          status: 'killed',
          endedAt: startedAt + playhead,
          durationMs: Math.max(0, playhead - other.start),
        });
      }
    }
    stopped = true;
    window.clearInterval(timer);
    hooks.onRunEnd({
      status: 'failed',
      endedAt: startedAt + playhead,
      errorSummary: reason,
      killedBy: 'budget',
    });
  }

  function killRun() {
    if (stopped) return;
    stopped = true;
    window.clearInterval(timer);
    for (const rs of running.values()) {
      if (rs.endedEmitted || !rs.startedEmitted) continue;
      const status: Span['status'] = rs.approval ? 'pending' : 'killed';
      hooks.onSpanEnd(rs.id, {
        status,
        endedAt: startedAt + playhead,
        durationMs: Math.max(0, playhead - rs.start),
        error:
          status === 'killed'
            ? { name: 'KilledByUser', message: 'Run stopped by user' }
            : undefined,
      });
      rs.endedEmitted = true;
      recordSpan(rs, true); // Phase 13: tokens already streamed were spent
    }
    hooks.onRunEnd({ status: 'killed', endedAt: startedAt + playhead });
  }

  const timer = window.setInterval(() => {
    if (stopped) return;
    if (parkedAt) return; // parked at the approval gate
    if (gatingAt) return; // parked on the budget governor (Phase 13)

    playhead += TICK_MS * speed;
    let done = false;

    for (const rs of running.values()) {
      const startAt = rs.start;
      const endAt = rs.start + rs.duration;

      // Phase 13: an LLM span asks the governor before it starts. The run
      // parks (no playhead advance) until the verdict lands.
      if (
        !rs.startedEmitted &&
        playhead >= startAt &&
        rs.category === 'llm' &&
        budget &&
        !rs.gated
      ) {
        rs.gated = true;
        gatingAt = rs.id;
        const model = rs.model ?? script.model;
        void budget
          .gate({
            model,
            estimatedTokensIn: rs.tokensIn ?? 0,
            estimatedTokensOut: rs.tokensOut ?? 0,
            estimatedCost: rs.costUsd ?? 0,
            agent: script.agent,
            workspace: script.workspace ?? null,
            sessionId: runId,
          })
          .then((v) => {
            gatingAt = null;
            if (stopped) return;
            if (!v.allowed) {
              budgetStop(rs, v.reason ?? 'Budget limit reached', false);
              return;
            }
            rs.hardRemaining = v.hardRemaining;
            if (v.downgradedToModel) {
              rs.model = v.model;
              rs.costUsd = v.estimatedCost;
              rs.metadata = {
                ...rs.metadata,
                budgetDownshift: {
                  from: model,
                  to: v.model,
                  why: v.downshiftWhy,
                },
              };
              hooks.onLog(
                rs.id,
                'system',
                `budget: switched ${model} → ${v.model} — ${v.downshiftWhy ?? 'to stay within budget'}`
              );
            }
          })
          .catch(() => {
            gatingAt = null;
            if (!stopped)
              budgetStop(rs, 'Budget check failed — nothing was sent.', false);
          });
        return;
      }

      // Emit start
      if (!rs.startedEmitted && playhead >= startAt) {
        rs.startedEmitted = true;
        hooks.onSpanStart({
          id: rs.id,
          parentId: rs.parentId,
          name: rs.name,
          category: rs.category,
          status: rs.approval ? 'waiting' : 'running',
          startedAt: startedAt + startAt,
          endedAt: null,
          durationMs: 0,
          model: rs.model,
          inputs: rs.inputs,
          metadata: rs.metadata,
          tokensIn: rs.tokensIn,
          costUsd: rs.costUsd,
        });
        if (rs.approval) {
          // Park: the Phase 7 modal takes over until the store resolves it.
          parkedAt = rs.id;
          hooks.onApprovalWait(rs.id, rs.approval.spec);
          return;
        }
      }

      // Log lines
      if (rs.logs && rs.startedEmitted && !rs.endedEmitted) {
        while (
          rs.logIdx < rs.logs.length &&
          playhead - startAt >= rs.logs[rs.logIdx].at
        ) {
          const l = rs.logs[rs.logIdx];
          hooks.onLog(rs.id, l.stream, l.text);
          rs.logIdx += 1;
        }
      }

      // Token ticks for running LLM spans
      if (
        rs.category === 'llm' &&
        !rs.endedEmitted &&
        playhead < endAt &&
        rs.tokensOut
      ) {
        const frac = (playhead - startAt) / rs.duration;
        const target = Math.floor(rs.tokensOut * Math.min(1, frac));
        if (target > rs.tokenAcc) {
          const delta = target - rs.tokenAcc;
          rs.tokenAcc = target;
          hooks.onTokenTick(
            rs.id,
            delta,
            rs.costUsd ? (rs.costUsd * delta) / rs.tokensOut : 0
          );
          // Phase 13 mid-stream guard: stop at the hard limit, not after it.
          if (
            rs.hardRemaining != null &&
            rs.costUsd &&
            (rs.costUsd * rs.tokenAcc) / rs.tokensOut >=
              rs.hardRemaining - BUDGET_EPS
          ) {
            budgetStop(
              rs,
              'Stopped at the hard budget limit — raise the limit under Budget to continue.',
              true
            );
            return;
          }
        }
      }

      // Emit end
      if (!rs.endedEmitted && rs.startedEmitted && playhead >= endAt) {
        const isErrorSpan = rs.id === failSpanId || rs.error !== undefined;
        finishSpan(
          rs,
          isErrorSpan ? 'failed' : 'completed',
          isErrorSpan ? rs.error : undefined
        );
      }
    }

    // Error flavour: when the failing span ends, abort the run.
    if (failSpanId) {
      const fs = running.get(failSpanId);
      if (fs?.endedEmitted) {
        // Mark not-yet-started spans pending and stop the run.
        for (const rs of running.values()) {
          if (!rs.startedEmitted) {
            rs.startedEmitted = true;
            rs.endedEmitted = true;
            hooks.onSpanEnd(rs.id, { status: 'pending' });
          }
        }
        done = true;
        hooks.onRunEnd({ status: 'failed', endedAt: startedAt + playhead });
      }
    } else if (playhead >= script.totalDuration) {
      done = true;
      hooks.onRunEnd({
        status: 'completed',
        endedAt: startedAt + script.totalDuration,
      });
    }
    if (done) {
      stopped = true;
      window.clearInterval(timer);
    }
  }, TICK_MS);

  const handle: StreamHandle = {
    resolveApproval: (approved) => {
      if (!parkedAt) return;
      const rs = running.get(parkedAt);
      parkedAt = null;
      if (!rs || rs.endedEmitted) return;
      finishSpan(
        rs,
        approved ? 'completed' : 'failed',
        approved
          ? undefined
          : { name: 'DeniedByUser', message: 'Denied by user' }
      );
      if (!approved) {
        // Denial kills the run: everything downstream stays pending.
        for (const other of running.values()) {
          if (!other.startedEmitted && other.id !== rs.id) {
            other.startedEmitted = true;
            other.endedEmitted = true;
            hooks.onSpanEnd(other.id, { status: 'pending' });
          }
        }
        stopped = true;
        hooks.onRunEnd({ status: 'failed', endedAt: startedAt + playhead });
        return;
      }
      // Fast-forward past the gate; downstream spans keep their offsets.
      playhead = Math.max(playhead, rs.start + 200);
    },
    stop: killRun,
    isWaitingApproval: () => parkedAt !== null,
    isWaitingBudget: () => gatingAt !== null,
  };
  return handle;
}
