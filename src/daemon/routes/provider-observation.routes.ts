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
      const report = await providerGateway.health(config, preset.id, model);
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
