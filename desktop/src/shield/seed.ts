/*
 * Deterministic Shield seed (Phase 12): 200 audit entries over the last 30
 * days, three quarantined skills. Fixed-seed PRNG (mulberry32) so ids,
 * actions, decisions and relative timings are identical on every fresh
 * install; absolute timestamps follow the clock (always in the past). The
 * Rust module ports the same tables so a native install looks the same.
 */
import type { ApprovalRisk } from '@/lib/approvalCore';

import { chainEntry, type HashFn } from '@/shield/core';
import type {
  AuditDecision,
  AuditEntry,
  QuarantinedSkill,
} from '@/shield/types';

export const SEED_COUNT = 200;
const SEED = 0x5a1e1d;
const DAY = 24 * 60 * 60 * 1000;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ActionDef {
  skill: string;
  action: string;
  resources: readonly (string | null)[];
  risk: ApprovalRisk;
  /** Cloud-priced actions carry a small cost; local ones are free. */
  cost: boolean;
}

const ACTIONS: readonly ActionDef[] = [
  {
    skill: 'fs-skill',
    action: 'Read a file',
    resources: [
      '~/notes/standup.md',
      '~/projects/xr/README.md',
      '~/Downloads/invoice-0423.pdf',
      '~/.config/xr/settings.json',
    ],
    risk: 'low',
    cost: false,
  },
  {
    skill: 'fs-skill',
    action: 'List a directory',
    resources: ['~/projects', '~/Documents/contracts'],
    risk: 'low',
    cost: false,
  },
  {
    skill: 'fs-skill',
    action: 'Write a file',
    resources: [
      '~/notes/standup.md',
      '~/projects/xr/CHANGELOG.md',
      '~/Desktop/summary.txt',
    ],
    risk: 'medium',
    cost: false,
  },
  {
    skill: 'fs-skill',
    action: 'Delete a folder',
    resources: ['~/projects/old-build', '~/tmp/cache-2025'],
    risk: 'high',
    cost: false,
  },
  {
    skill: 'gmail-skill',
    action: 'Read inbox',
    resources: ['from:s•••@company.com', 'label:invoices'],
    risk: 'low',
    cost: true,
  },
  {
    skill: 'gmail-skill',
    action: 'Send email',
    resources: ['s•••@company.com', 'f•••@company.com', 'o•••@partner.io'],
    risk: 'medium',
    cost: true,
  },
  {
    skill: 'calendar-skill',
    action: 'Read calendar',
    resources: ['this week', 'tomorrow'],
    risk: 'low',
    cost: false,
  },
  {
    skill: 'calendar-skill',
    action: 'Create an event',
    resources: ['Standup · Tue 10:00', 'Design review · Thu 15:30'],
    risk: 'medium',
    cost: false,
  },
  {
    skill: 'web-skill',
    action: 'Fetch a web page',
    resources: [
      'https://docs.rs/rusqlite',
      'https://news.ycombinator.com',
      'https://api.github.com/repos/ahmadrrrtx/xr',
    ],
    risk: 'low',
    cost: true,
  },
  {
    skill: 'github-skill',
    action: 'Open a pull request',
    resources: ['ahmadrrrtx/xr#153', 'ahmadrrrtx/xr#161'],
    risk: 'medium',
    cost: true,
  },
  {
    skill: 'github-skill',
    action: 'Push to a branch',
    resources: ['phase/11-control-room', 'phase/12-shield'],
    risk: 'high',
    cost: false,
  },
  {
    skill: 'slack-skill',
    action: 'Post a message',
    resources: ['#eng-updates', '#design'],
    risk: 'medium',
    cost: true,
  },
  {
    skill: 'shell-skill',
    action: 'Run a shell command',
    resources: [
      null,
      'brew upgrade && brew cleanup',
      'git status',
      'rm -rf ~/tmp/cache-2025',
    ],
    risk: 'high',
    cost: false,
  },
  {
    skill: 'figma-plugin',
    action: 'Export frames',
    resources: ['Onboarding v3', 'Shield · Status'],
    risk: 'medium',
    cost: false,
  },
  {
    skill: 'legacy-exec',
    action: 'Run a script',
    resources: ['deploy.sh', 'cleanup.py'],
    risk: 'high',
    cost: false,
  },
  {
    skill: 'unknown-skill',
    action: 'Read contacts',
    resources: [null],
    risk: 'medium',
    cost: false,
  },
];

const AGENTS = [
  'agent:main',
  'agent:main',
  'agent:coder',
  'agent:research',
  'agent:writer',
];

/** Mock quarantine list — the three skills the brief names. */
export function seedQuarantine(now: number): QuarantinedSkill[] {
  return [
    {
      id: 'figma-plugin',
      name: 'figma-plugin',
      version: '0.3.1',
      source: 'Skills Store · unsigned',
      reason:
        'No publisher signature. Requests file export and network access.',
      quarantinedAt: now - 3 * DAY - 2 * 60 * 60 * 1000,
      status: 'quarantined',
    },
    {
      id: 'legacy-exec',
      name: 'legacy-exec',
      version: '1.0.0',
      source: 'Local install',
      reason: 'Requests shell execution with no manifest capability list.',
      quarantinedAt: now - 9 * DAY,
      status: 'quarantined',
    },
    {
      id: 'unknown-skill',
      name: 'unknown-skill',
      version: '—',
      source: 'Sideloaded',
      reason: 'No manifest. Identity could not be established.',
      quarantinedAt: now - 20 * DAY - 5 * 60 * 60 * 1000,
      status: 'quarantined',
    },
  ];
}

const QUARANTINED = new Set(['figma-plugin', 'legacy-exec', 'unknown-skill']);

type SeedInput = Omit<AuditEntry, 'hash' | 'signature' | 'prevHash'>;

function pick<T>(rnd: () => number, list: readonly T[]): T {
  return list[Math.floor(rnd() * list.length)];
}

/**
 * Decide how a seeded request resolved. Quarantined skills never auto-run;
 * shell is mostly blocked (the default policy keeps shell off); low-risk
 * actions are mostly auto-approved by policy; the rest asked the human.
 */
function decideSeed(
  rnd: () => number,
  def: ActionDef
): {
  decision: AuditDecision;
  actor: string;
  ruleId: string | null;
  detail: string | null;
} {
  const r = rnd();
  if (QUARANTINED.has(def.skill)) {
    return r < 0.75
      ? {
          decision: 'quarantined',
          actor: pick(rnd, AGENTS),
          ruleId: 'policy.quarantine',
          detail: `${def.skill} is quarantined — request held for explicit approval.`,
        }
      : {
          decision: 'denied',
          actor: 'user',
          ruleId: null,
          detail: 'Denied from the approval prompt.',
        };
  }
  if (def.skill === 'shell-skill') {
    if (r < 0.7)
      return {
        decision: 'blocked',
        actor: pick(rnd, AGENTS),
        ruleId: 'policy.shell-exec',
        detail: 'Shell execution is disabled in Security Settings.',
      };
    if (r < 0.9)
      return {
        decision: 'allowed',
        actor: 'user',
        ruleId: null,
        detail: 'Approved once from the prompt.',
      };
    return {
      decision: 'denied',
      actor: 'user',
      ruleId: null,
      detail: 'Denied from the approval prompt.',
    };
  }
  if (def.risk === 'low') {
    if (r < 0.9)
      return {
        decision: 'auto-approved',
        actor: pick(rnd, AGENTS),
        ruleId: 'policy.auto-approve-low',
        detail: 'Low risk — ran without a prompt.',
      };
    if (r < 0.96)
      return {
        decision: 'allowed',
        actor: 'user',
        ruleId: null,
        detail: 'Approved from the prompt.',
      };
    return {
      decision: 'error',
      actor: pick(rnd, AGENTS),
      ruleId: null,
      detail: 'The skill returned an error after approval.',
    };
  }
  if (def.risk === 'medium') {
    if (r < 0.5)
      return {
        decision: 'allowed',
        actor: 'user',
        ruleId: null,
        detail: 'Approved from the prompt.',
      };
    if (r < 0.82)
      return {
        decision: 'auto-approved',
        actor: pick(rnd, AGENTS),
        ruleId: `rule.${def.skill}.${def.action.toLowerCase().replace(/[^a-z]+/g, '-')}`,
        detail: 'A remember rule you created matched.',
      };
    if (r < 0.95)
      return {
        decision: 'denied',
        actor: 'user',
        ruleId: null,
        detail: 'Denied from the prompt.',
      };
    return {
      decision: 'error',
      actor: pick(rnd, AGENTS),
      ruleId: null,
      detail: 'The skill returned an error after approval.',
    };
  }
  if (r < 0.55)
    return {
      decision: 'allowed',
      actor: 'user',
      ruleId: null,
      detail: 'Approved after review.',
    };
  if (r < 0.9)
    return {
      decision: 'denied',
      actor: 'user',
      ruleId: null,
      detail: 'Denied — not worth the risk.',
    };
  return {
    decision: 'blocked',
    actor: pick(rnd, AGENTS),
    ruleId: 'policy.paused',
    detail: 'XR was paused when this arrived.',
  };
}

/** The 200 inputs, oldest first, before chaining. Pure and deterministic. */
export function seedAuditInputs(now: number, count = SEED_COUNT): SeedInput[] {
  const rnd = mulberry32(SEED);
  // Offsets back from `now`: denser in the last 48 h (sqrt skew), none in the future.
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) {
    const u = rnd();
    const skew = u * u; // more mass near 0 → recent
    offsets.push(Math.floor(60_000 + skew * (30 * DAY - 120_000)));
  }
  offsets.sort((a, b) => b - a); // oldest first
  const out: SeedInput[] = [];
  for (let i = 0; i < count; i++) {
    const def = pick(rnd, ACTIONS);
    const resource = pick(rnd, def.resources);
    const d = decideSeed(rnd, def);
    const ran = d.decision === 'allowed' || d.decision === 'auto-approved';
    const cost =
      ran && def.cost
        ? Math.round(rnd() * 0.08 * 10000) / 10000
        : ran
          ? 0
          : null;
    out.push({
      id: `aud_${String(i + 1).padStart(6, '0')}`,
      ts: now - offsets[i],
      actor: d.actor,
      skill: def.skill,
      action: def.action,
      resource,
      decision: d.decision,
      ruleId: d.ruleId,
      risk: def.risk,
      costUsd: cost,
      detail: d.detail,
    });
  }
  // A few system rows the health check / policy edits would have produced.
  const systemRows: Array<[number, string, string | null]> = [
    [27 * DAY, 'Health check completed', '9 checks · 7 passed · 2 planned'],
    [14 * DAY, 'Policy updated', 'quarantineNewSkills: on'],
    [6 * DAY, 'Health check completed', '9 checks · 7 passed · 2 planned'],
    [2 * DAY, 'Policy updated', 'allowShellExec: off'],
  ];
  for (const [ago, action, detail] of systemRows) {
    out.push({
      id: `aud_${String(out.length + 1).padStart(6, '0')}`,
      ts: now - ago - 17 * 60_000,
      actor: 'system',
      skill: null,
      action,
      resource: null,
      decision: 'allowed',
      ruleId: null,
      risk: 'low',
      costUsd: null,
      detail,
    });
  }
  out.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  return out;
}

/** Chain the seed (oldest first) with the given hash function. */
export async function buildSeedChain(
  now: number,
  sha256: HashFn,
  count = SEED_COUNT
): Promise<AuditEntry[]> {
  const inputs = seedAuditInputs(now, count);
  const out: AuditEntry[] = [];
  let tail: AuditEntry | null = null;
  for (const input of inputs) {
    tail = await chainEntry(input, tail, sha256);
    out.push(tail);
  }
  return out;
}
