/** Pure view of the governed engine catalog. Never an independent router. */
import { estimateCost, qualifiedModelId } from '../budget/models';
import { priceFor, pricingAvailable } from '../../../src/cost/pricing';
import type { ModelDescriptor } from '../../../src/intelligence/types';
import type { EngineModelsResponse, EngineProvidersResponse } from './types';
export interface EngineCatalog {
  builtAt: number;
  models: Array<
    Pick<
      ModelDescriptor,
      | 'providerId'
      | 'modelId'
      | 'isDefault'
      | 'capabilities'
      | 'cost'
      | 'evidence'
    > & { locality: string; contextWindow?: number }
  >;
}
export interface EngineModelOption {
  /** Qualified selection identity, not just a vendor-ambiguous model name. */
  id: string;
  modelId: string;
  label: string;
  provider: string;
  providerLabel: string;
  kind: 'local' | 'cloud';
  locality: string;
  /** Selectable/configured, NOT authenticated/reachable/agent-validated. */
  available: boolean;
  discovered?: boolean;
  unavailableReason?: string;
  detail?: string;
  isDefault: boolean;
  contextWindow?: number;
  inPerMTok?: number;
  outPerMTok?: number;
  evidence?: EngineCatalog['models'][number]['evidence'];
}
export function modelOptions(
  providers: EngineProvidersResponse | null,
  models: EngineModelsResponse | null,
  catalog: EngineCatalog | null
): { local: EngineModelOption[]; cloud: EngineModelOption[] } {
  const groups: { local: EngineModelOption[]; cloud: EngineModelOption[] } = {
    local: [],
    cloud: [],
  };
  if (!providers) return groups;
  const rows = [...(catalog?.models ?? [])];
  // A saved choice remains inspectable if a refresh omitted/deprecated it. It
  // does NOT become discovered/installed/healthy as a side effect of saving.
  if (
    providers.model &&
    !rows.some(
      (m) => m.providerId === providers.primary && m.modelId === providers.model
    )
  ) {
    rows.push({
      providerId: providers.primary,
      modelId: providers.model,
      isDefault: true,
      locality:
        providers.providers.find((p) => p.id === providers.primary)?.locality ??
        'unknown',
      cost: { tier: 'custom', free: false },
      capabilities: {} as ModelDescriptor['capabilities'],
    });
  }
  const runtime = models?.current;
  const installed = new Set(
    (runtime?.models ?? [])
      .map((m) => (typeof m === 'string' ? m : (m.name ?? m.model ?? m.id)))
      .filter(Boolean)
  );
  for (const name of installed)
    if (
      runtime &&
      typeof name === 'string' &&
      !rows.some(
        (m) => m.providerId === runtime.providerId && m.modelId === name
      )
    ) {
      rows.push({
        providerId: runtime.providerId,
        modelId: name,
        isDefault: false,
        locality:
          providers.providers.find((p) => p.id === runtime.providerId)
            ?.locality ?? 'unknown',
        capabilities: {} as ModelDescriptor['capabilities'],
        cost: { tier: 'free', free: true, inPerMTok: 0, outPerMTok: 0 },
      });
    }
  const seen = new Set<string>();
  for (const m of rows) {
    const p = providers.providers.find((p) => p.id === m.providerId);
    if (!p) continue;
    const id = qualifiedModelId(m.providerId, m.modelId);
    if (seen.has(id)) continue;
    seen.add(id);
    const local = m.locality === 'local';
    const discovered =
      local &&
      runtime?.providerId === p.id &&
      runtime.running &&
      installed.has(m.modelId);
    const registered = !!catalog?.models.some(
      (row) => row.providerId === p.id && row.modelId === m.modelId
    );
    const available = local
      ? discovered && registered
      : p.kind !== 'local' && p.hasKey && registered;
    const state = m.evidence?.reachable ?? 'unknown';
    const detail = `${available ? 'Configured' : 'Not verified/configured'} · reachability ${state} · agent ${m.evidence?.agentValidated ? 'validated' : 'not validated'}${m.evidence?.stale ? ' · stale metadata' : ''}${m.evidence?.lifecycle === 'deprecated' ? ' · deprecated (manual only)' : ''}`;
    groups[local ? 'local' : 'cloud'].push({
      id,
      modelId: m.modelId,
      label: m.modelId,
      provider: p.id,
      providerLabel: p.label,
      kind: local ? 'local' : 'cloud',
      locality: m.locality,
      available: !!available,
      discovered: !!discovered,
      unavailableReason: available
        ? undefined
        : local
          ? discovered
            ? 'Discovered; register as engine default or in model settings before use'
            : 'Run explicit local discovery; runtime/model availability is not inferred'
          : p.kind === 'local'
            ? 'Remote local-runtime endpoint: explicit validation/rates required'
            : 'Configure provider credentials',
      detail,
      isDefault:
        m.providerId === providers.primary && m.modelId === providers.model,
      contextWindow: m.contextWindow,
      inPerMTok: m.cost.inPerMTok,
      outPerMTok: m.cost.outPerMTok,
      evidence: m.evidence,
    });
  }
  return groups;
}
/** Configured operator prices can be surfaced by the engine. Static base rates
 * alone must not classify a remote local-runtime URL as free. */
export function catalogQuote(
  catalog: EngineCatalog | null,
  provider: string,
  model: string,
  input: number,
  output: number,
  now = Date.now()
): number {
  const row = catalog?.models.find(
    (m) => m.providerId === provider && m.modelId === model
  );
  if (!row) return NaN;
  if (row.cost.known !== true || !row.cost.source) return NaN;
  const i = row.cost.inPerMTok,
    o = row.cost.outPerMTok;
  if (
    typeof i !== 'number' ||
    typeof o !== 'number' ||
    ![i, o, input, output].every((n) => Number.isFinite(n) && n >= 0)
  )
    return NaN;
  const base = priceFor(provider, model, { now });
  if (row.cost.source.startsWith('https://') && !pricingAvailable(base))
    return NaN;
  if (
    pricingAvailable(base) &&
    i === base.inPerMTok &&
    o === base.outPerMTok &&
    (base.source !== 'local-no-provider-token-fee' || row.locality === 'local')
  )
    return estimateCost(qualifiedModelId(provider, model), input, output, now);
  // The engine has already validated catalog overrides. It will independently
  // admit/settle the real call; this client estimate never grants authority.
  if (i === 0 && o === 0 && row.cost.free && row.locality !== 'local')
    return NaN;
  return (input * i + output * o) / 1_000_000;
}
