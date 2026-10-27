/*
 * Model select (Phase 19) — the same source as Chat's model picker
 * (engineStore catalogue: local runtime models + cloud providers with a
 * key). Unavailable rows stay listed but disabled with the reason; a value
 * the catalogue does not know is kept and labelled, never dropped.
 */
import { useEffect, useMemo } from 'react';

import { engineModelOptions, useEngineStore } from '@/stores/engineStore';

export function ModelSelect({
  value,
  provider,
  onChange,
  id,
  invalid,
  allowDefault = true,
}: {
  value: string;
  provider?: string;
  onChange: (next: { model: string; provider: string }) => void;
  id?: string;
  invalid?: boolean;
  /** Offer "Engine default" (empty) as the first row. */
  allowDefault?: boolean;
}) {
  const providers = useEngineStore((s) => s.providers);
  const models = useEngineStore((s) => s.models);
  const catalog = useEngineStore((s) => s.catalog);
  const status = useEngineStore((s) => s.status);

  useEffect(() => {
    void useEngineStore.getState().loadCatalog();
  }, []);

  const groups = useMemo(
    () => engineModelOptions(providers, models, catalog),
    [providers, models, catalog]
  );
  const all = [...groups.local, ...groups.cloud];
  const matching = all.filter(
    (o) =>
      o.id === value ||
      (o.modelId === value && (!provider || o.provider === provider))
  );
  const selected = matching.length === 1 ? matching[0].id : value;
  const known = matching.length === 1;

  return (
    <select
      id={id}
      className="xa-select"
      value={selected}
      aria-invalid={invalid || undefined}
      onChange={(e) => {
        const next = e.target.value;
        const opt = [...groups.local, ...groups.cloud].find(
          (o) => o.id === next
        );
        onChange({
          model: opt?.modelId ?? next,
          provider: opt?.provider ?? '',
        });
      }}
      data-testid="model-select"
    >
      {allowDefault ? <option value="">Engine default</option> : null}
      {!known && value ? (
        <option value={value}>{value} (not in catalogue)</option>
      ) : null}
      {groups.local.length ? (
        <optgroup label="Local">
          {groups.local.map((o) => (
            <option key={o.id} value={o.id} disabled={!o.available}>
              {o.label}
              {o.detail ? ` · ${o.detail}` : ''} · no provider token fee
              (hardware excluded)
              {!o.available ? ` · ${o.unavailableReason ?? 'offline'}` : ''}
            </option>
          ))}
        </optgroup>
      ) : null}
      {groups.cloud.length ? (
        <optgroup label="Cloud">
          {groups.cloud.map((o) => (
            <option key={o.id} value={o.id} disabled={!o.available}>
              {o.label} · {o.providerLabel}
              {!o.available ? ` · ${o.unavailableReason ?? 'no key'}` : ''}
            </option>
          ))}
        </optgroup>
      ) : null}
      {status !== 'up' && !groups.local.length && !groups.cloud.length ? (
        <option disabled>Engine not reachable — no catalogue</option>
      ) : null}
    </select>
  );
}
