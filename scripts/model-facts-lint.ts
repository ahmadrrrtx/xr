/**
 * XR-REL-07 — the model-facts register is a claim, so it gets a linter.
 *
 * `src/core/model-facts.json` is the ONLY offline source of model truth: context
 * windows, output limits, prices, lifecycle and — since XR-REL-07 — whether an
 * XR agent has actually run against a model (`agentValidated`) or an adapter
 * contract test exercises it in CI (`contractTested`). Everything downstream
 * (the routing scorer, the price display, `evidence.stale`) reads it.
 *
 * It drifted anyway, because nothing checked it: the shipped register was dated
 * 2026-10-26 while the app rendered prices from it, and three model ids were
 * hardcoded as "contract-tested" inside `capability.ts` — a claim with no
 * evidence in the register at all. That is precisely the class of claim
 * Article XIX.1 says the linter must stop, so the linter now reads it.
 *
 * Deliberately NOT fatal:
 *   · coverage below 100% of `knownModels` — a register that only carries
 *     verified entries is better than a padded one, and coverage is reported so
 *     the number can be watched instead of guessed.
 * Fatal:
 *   · the register is past `staleAt`;
 *   · a model id appears twice (which facts win?);
 *   · a "positive" claim (price, contractTested, agentValidated) without a
 *     source;
 *   · `verifiedAt`/`staleAt` that are not parseable dates, or a staleAt that is
 *     not after verifiedAt.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ModelFactEntry {
  providerId: string;
  modelId: string;
  lifecycle?: string;
  source?: string;
  contextWindow?: number;
  maxOutputTokens?: number | null;
  tools?: boolean;
  reasoning?: boolean;
  agentValidated?: boolean;
  /** Path of the test that exercises this model id — evidence, not a boolean. */
  contractTest?: string;
  price?: { input?: number; output?: number; source?: string };
  notes?: string[];
}

export interface ModelFactsFile {
  version: string;
  verifiedAt: string;
  staleAt: string;
  models: ModelFactEntry[];
}

export interface ModelFactsViolation {
  gate: 'model-facts';
  file: string;
  line: number;
  text: string;
  reason: string;
}

export interface ModelFactsCoverage {
  /** Models the presets advertise. */
  catalogued: number;
  /** Of those, how many have an entry in the register. */
  documented: number;
  /** Documented models that have no verified price. */
  unpriced: number;
}

export interface ModelFactsReport {
  violations: ModelFactsViolation[];
  coverage: ModelFactsCoverage;
  notes: string[];
}

const FILE = 'src/core/model-facts.json';

/** Coverage ratio below which the register is reported as thin (a note, not a failure). */
export const THIN_COVERAGE = 0.5;

/**
 * Lint the register. `presets` is injected so this stays a pure function and a
 * test can drive it with a synthetic catalogue.
 */
export function lintModelFacts(
  facts: ModelFactsFile,
  presets: Array<{ id: string; knownModels?: string[] }>,
  now: number = Date.now(),
  file = FILE,
  root = process.cwd()
): ModelFactsReport {
  const violations: ModelFactsViolation[] = [];
  const notes: string[] = [];
  const push = (reason: string, text: string, line = 0): void => {
    violations.push({ gate: 'model-facts', file, line, text, reason });
  };

  // ── the register's own dates
  const verified = Date.parse(facts.verifiedAt);
  const stale = Date.parse(facts.staleAt);
  if (!Number.isFinite(verified)) {
    push('`verifiedAt` is not a parseable date', String(facts.verifiedAt));
  }
  if (!Number.isFinite(stale)) {
    push('`staleAt` is not a parseable timestamp', String(facts.staleAt));
  }
  if (Number.isFinite(verified) && Number.isFinite(stale) && stale <= verified) {
    push('`staleAt` is not after `verifiedAt`', `${facts.verifiedAt} → ${facts.staleAt}`);
  }
  if (Number.isFinite(stale) && now > stale) {
    const days = Math.floor((now - stale) / 86_400_000);
    push(
      `the model register went stale ${days} day(s) ago — re-verify it, or every price and context figure the app shows is an unverified claim`,
      `staleAt ${facts.staleAt}`
    );
  }

  // ── per-entry integrity
  const seen = new Set<string>();
  let unpriced = 0;
  for (const m of facts.models) {
    const key = `${m.providerId}/${m.modelId}`;
    const line = typeof m.contextWindow === 'number' ? m.contextWindow : 0;
    if (!m.providerId || !m.modelId) {
      push('an entry is missing providerId or modelId', JSON.stringify(m).slice(0, 120), line);
      continue;
    }
    if (seen.has(key)) {
      push('`' + key + '` appears twice — which facts win is undefined', key, line);
    }
    seen.add(key);

    if (!m.source) {
      push('`' + key + '` has no `source` — a fact without a source is a rumour', key, line);
    }
    if (m.price) {
      if (typeof m.price.input !== 'number' || typeof m.price.output !== 'number') {
        push('`' + key + '` has a price without both input and output rates', key, line);
      }
      if (!m.price.source) {
        push('`' + key + '` has a price with no `price.source`', key, line);
      }
    } else if (m.lifecycle !== 'deprecated') {
      unpriced += 1;
    }
    if (m.contractTest) {
      // A test path is checkable: it must resolve in this tree, or the
      // "contract-tested" claim has nothing behind it.
      if (!existsSync(join(root, m.contractTest))) {
        push(
          '`' + key + '` claims `contractTest` ' + m.contractTest + ' but that file does not exist',
          m.contractTest,
          line
        );
      }
      if (!m.agentValidated) {
        // Allowed, but worth saying: a passing adapter test is not an agent run.
        notes.push(`${key}: contract-tested but never agent-validated (that is fine — it is just not the same claim)`);
      }
    } else if (m.agentValidated) {
      notes.push(`${key}: agent-validated (an end-to-end XR run), which subsumes the adapter test`);
    }
    for (const field of ['contextWindow', 'maxOutputTokens'] as const) {
      const v = m[field];
      if (v !== undefined && v !== null && (!Number.isInteger(v) || v <= 0)) {
        push('`' + key + '` has a non-positive ' + field, String(v), line);
      }
    }
  }

  // ── coverage of what the presets actually advertise
  let catalogued = 0;
  let documented = 0;
  for (const p of presets) {
    for (const modelId of p.knownModels ?? []) {
      catalogued += 1;
      if (seen.has(`${p.id}/${modelId}`)) documented += 1;
    }
  }
  const coverage: ModelFactsCoverage = { catalogued, documented, unpriced };
  if (catalogued > 0 && documented / catalogued < THIN_COVERAGE) {
    notes.push(
      `the register documents ${documented}/${catalogued} catalogued models (${Math.round(
        (documented / catalogued) * 100
      )}%) — thin, but every entry present is sourced`
    );
  }

  return { violations, coverage, notes };
}

/** Read + lint the repository's own register against its own presets. */
export async function lintRepositoryModelFacts(root: string): Promise<ModelFactsReport> {
  const facts = JSON.parse(readFileSync(join(root, FILE), 'utf8')) as ModelFactsFile;
  // A bare Windows drive path is not a valid dynamic-import specifier; a file
  // URL is, and works unchanged on POSIX.
  const { pathToFileURL } = await import('node:url');
  const { PRESETS } = await import(pathToFileURL(join(root, 'src/providers/presets.ts')).href);
  const presets = Object.values(PRESETS as Record<string, { id: string; knownModels?: string[] }>);
  return lintModelFacts(facts, presets, Date.now(), FILE, root);
}
