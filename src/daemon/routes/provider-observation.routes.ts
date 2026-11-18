/** Explicit, authenticated provider observations. Never enumerate/probe while listing metadata. */
import { providerGateway } from '../../providers/gateway.ts';
import { route, type DaemonRoute } from './router.ts';

export function providerObservationRoutes(): DaemonRoute[] {
  return [route({
    id: 'providers.probe', path: '/api/providers/probe', method: 'POST',
    handle: async ({ req, json, config, state }) => {
      const body = await req.json() as { providerId: string; model?: string };
      providerGateway.list(config); // sync configured custom factories, not vendor discovery
      const preset = providerGateway.getPreset(body.providerId);
      if (!preset) return json({ error: 'Unknown configured provider' }, 404);
      const model = body.model ?? preset.defaultModel;
      const cred = providerGateway.credentialStatus(preset.id);
      // Uses the same adapter/broker as inference. Some health adapters send a
      // minimal completion: the initiating UI must disclose possible charges.
      const report = await providerGateway.health(config, preset.id, model, { fresh: true });
      state.store.audit('providers.probe', { providerId: preset.id, model, ok: report.ok });
      return json({
        ok: report.ok, providerId: preset.id, model, source: 'engine-adapter',
        checkedAt: report.timestamp, latencyMs: report.latencyMs ?? null,
        detail: report.detail, inferenceVerified: false,
        authState: cred.required ? (cred.available ? 'configured' : 'missing_credentials') : 'not_required',
      });
    },
  })];
}

/** Explicit adapter calls only. Vendor-specific adapters without this contract
 * report unsupported; a listModels() returning [] is never discovery proof. */
export function providerDiscoveryRoutes(): DaemonRoute[] {
  return (['discover', 'validate'] as const).map(action => route({
    id: `providers.${action}`, path: `/api/providers/${action}`, method: 'POST',
    handle: async ({ req, config, json, state }) => {
      const body = await req.json() as { providerId: string; model?: string; capability?: import('../../providers/observations.ts').ValidationCapability; optIn?: boolean; allowBillable?: boolean };
      if (body.optIn !== true || (action === 'validate' && body.allowBillable !== true)) return json({ error: 'Explicit opt-in (and billable consent for validation) is required' }, 400);
      providerGateway.list(config);
      const preset = providerGateway.getPreset(body.providerId);
      if (!preset) return json({ error: 'Unknown configured provider' }, 404);
      const credential = providerGateway.credentialStatus(preset.id);
      const fallback = { providerId: preset.id, modelId: body.model ?? preset.defaultModel, source: 'engine-adapter/models', discoveredAt: new Date().toISOString(), checkedAt: new Date().toISOString(),
        capability: body.capability, status: 'unsupported', authState: 'unverified', complete: false, pages: 0, models: [], inferenceVerified: false, agentValidated: false, billingVerified: false, detail: 'This adapter has no bounded observation contract; keep the configured model.' };
      if (credential.required && !credential.available) return json({ ...fallback, status: 'missing_credentials', authState: 'missing_credentials', detail: 'Configure this endpoint credential first.' });
      const adapter = providerGateway.createProvider(preset.id, config, body.model ?? preset.defaultModel) as import('../../providers/openai-compat.ts').OpenAICompatProvider;
      let result: unknown = fallback;
      if (action === 'discover' && typeof adapter.discoverModels === 'function') result = await adapter.discoverModels({ signal: req.signal });
      if (action === 'validate' && body.capability && typeof adapter.validateModel === 'function') result = await adapter.validateModel(body.capability, { signal: req.signal });
      state.store.audit(`providers.${action}`, { providerId: preset.id, capability: body.capability, status: (result as { status: string }).status });
      return json(result);
    },
  }));
}
