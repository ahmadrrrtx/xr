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
  onChange,
  id,
  invalid,
  allowDefault = true,
}: {
  value: string;
  onChange: (next: { model: string; provider: string }) => void;
  id?: string;
  invalid?: boolean;
  /** Offer "Engine default" (empty) as the first row. */
  allowDefault?: boolean;
}) {
  const providers = useEngineStore((s) => s.providers);
  const models = useEngineStore((s) => s.models);
  const status = useEngineStore((s) => s.status);

  useEffect(() => {
    void useEngineStore.getState().loadCatalog();
  }, []);

  const groups = useMemo(() => engineModelOptions(providers, models), [providers, models]);
  const known = groups.local.some((o) => o.id === value) || groups.cloud.some((o) => o.id === value);

  return (
    <select
      id={id}
      className="xa-select"
      value={value}
      aria-invalid={invalid || undefined}
      onChange={(e) => {
        const next = e.target.value;
        const opt = [...groups.local, ...groups.cloud].find((o) => o.id === next);
        onChange({ model: next, provider: opt?.provider ?? '' });
      }}
      data-testid="model-select"
    >
      {allowDefault ? <option value="">Engine default</option> : null}
      {!known && value ? <option value={value}>{value} (not in catalogue)</option> : null}
      {groups.local.length ? (
        <optgroup label="Local">
          {groups.local.map((o) => (
            <option key={o.id} value={o.id} disabled={!o.available}>
              {o.label}
              {o.detail ? ` · ${o.detail}` : ''} · free{!o.available ? ` · ${o.unavailableReason ?? 'offline'}` : ''}
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
      {status !== 'up' && !groups.local.length && !groups.cloud.length ? <option disabled>Engine not reachable — no catalogue</option> : null}
    </select>
  );
}
