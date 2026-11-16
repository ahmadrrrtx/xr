/** Observations are an opt-in mirror of engine evidence, never a routing policy. */
import { useEffect, useState } from 'react';
import { discoverEngineModels, validateEngineModel, type DiscoveryObservation, type ModelValidationObservation, type ValidationCapability } from '@/engine/providers';
import { useEngineStore } from '@/stores/engineStore';
import { useMediaOperation } from '@/voice/useMediaOperation';

export function ProviderObservations({ providerId, model, onModel, ensureRegistered, disabled = false }: {
  providerId?: string; model: string; onModel: (id: string) => void;
  ensureRegistered?: (signal: AbortSignal) => Promise<string>; disabled?: boolean;
}) {
  const generation = useEngineStore(s => s.generation);
  const ready = useEngineStore(s => s.status === 'ready');
  const sameEngine = () => useEngineStore.getState().generation === generation && useEngineStore.getState().status === 'ready';
  const [busy, setBusy] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoveryObservation | null>(null);
  const [validation, setValidation] = useState<ModelValidationObservation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capability, setCapability] = useState<ValidationCapability>('chat');
  const { begin, cancel } = useMediaOperation(() => {});
  useEffect(() => { cancel(); setBusy(false); setValidation(null); }, [model, cancel]);
  useEffect(() => { cancel(); setBusy(false); setDiscovery(null); setValidation(null); }, [generation, cancel]);
  useEffect(() => { if (!ready) { cancel(); setBusy(false); } }, [ready, cancel]);
  const discover = async () => {
    const op = begin(); setBusy(true); setError(null);
    try {
      const id = ensureRegistered ? await ensureRegistered(op.signal) : providerId;
      if (!(op.current() && sameEngine())) return;
      if (!id) throw new Error('Save this endpoint in the engine first.');
      const result = await discoverEngineModels(id, op.signal);
      if ((op.current() && sameEngine())) setDiscovery(result); // failure NEVER changes the typed model
    } catch (e) { if ((op.current() && sameEngine())) setError(e instanceof Error ? e.message : 'Discovery failed; the configured model was retained.'); }
    finally { if ((op.current() && sameEngine())) setBusy(false); }
  };
  const validate = async () => {
    if (!providerId || !model.trim()) return;
    const op = begin(); setBusy(true); setError(null);
    try {
      const result = await validateEngineModel(providerId, model.trim(), capability, op.signal);
      if ((op.current() && sameEngine())) setValidation(result);
    } catch (e) { if ((op.current() && sameEngine())) setError(e instanceof Error ? e.message : 'Capability test failed.'); }
    finally { if ((op.current() && sameEngine())) setBusy(false); }
  };
  return <div className="border-border-subtle mt-4 space-y-2 border-t pt-3 text-xs">
    <p className="text-text-tertiary">Discovery contacts this endpoint only when requested, using the engine's saved credential. It does not prove inference or capabilities. Other adapters may require a manually entered model.</p>
    <button type="button" disabled={disabled || busy || !ready} onClick={() => void discover()} className="text-accent">
      {ensureRegistered ? 'Register endpoint & discover models' : 'Discover models through engine'}
    </button>
    {discovery ? <div role="status">
      <p>{discovery.status} · {discovery.models.length} observed{discovery.complete ? '' : ' · partial'} · {discovery.authState}</p>
      <p>{discovery.detail} · {discovery.source} · {discovery.discoveredAt}</p>
      {discovery.models.length ? <select aria-label="Discovered model" value={discovery.models.some(m => m.modelId === model) ? model : ''} onChange={e => { if (e.target.value) onModel(e.target.value); }}>
        <option value="">Choose an observed model (not selected automatically)</option>
        {discovery.models.map(m => <option key={m.modelId} value={m.modelId}>{m.modelId}</option>)}
      </select> : null}
    </div> : null}
    {providerId && model.trim() ? <div>
      <p className="text-text-tertiary">Each capability test may incur a minimal provider charge. No tool is executed. Results do not certify agent execution, billing accuracy, or other capabilities.</p>
      <select aria-label="Capability to test" value={capability} onChange={e => { cancel(); setBusy(false); setCapability(e.target.value as ValidationCapability); setValidation(null); }}>
        {(['chat', 'streaming', 'toolUse', 'jsonMode', 'usage'] as const).map(c => <option key={c} value={c}>{c}</option>)}
      </select>{' '}<button type="button" disabled={disabled || busy || !ready} onClick={() => void validate()} className="text-accent">Run potentially billable capability test</button>
    </div> : null}
    {validation ? <p role="status">{validation.capability}: {validation.status} · {validation.detail} · {validation.checkedAt}</p> : null}
    {error ? <p role="alert" className="text-danger">{error}</p> : null}
  </div>;
}
