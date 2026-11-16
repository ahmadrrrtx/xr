/** Opt-in wire observations. Listing is NEVER inference/capability certification.
 * No configuration/selection writes, no fallbacks and no tool execution. */
import { isChatCompletionObject, parseOpenAIToolCalls } from './native/schemas.ts';
import { guardedRequest, isCancellation, isTimeout, type ChatOptions } from './request-guard.ts';
export type ValidationCapability = 'chat' | 'streaming' | 'toolUse' | 'jsonMode' | 'usage';
export interface ObservationTransport {
  id: string; baseUrl: string; model: string;
  headers(): Record<string, string>;
  request(url: string, init: RequestInit): Promise<Response>;
}
const LIMIT = 256 * 1024;
async function text(res: Response, signal: AbortSignal): Promise<string> {
  const reader = res.body?.getReader(); if (!reader) throw new Error('empty body');
  let bytes = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read(); signal.throwIfAborted();
      if (part.done) break;
      bytes += part.value.byteLength; if (bytes > LIMIT) throw new Error('body limit');
      chunks.push(part.value);
    }
  } finally { void reader.cancel().catch(() => {}); }
  const data = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(data);
}
const untested = () => ({ chat: 'not_tested', streaming: 'not_tested', toolUse: 'not_tested', jsonMode: 'not_tested', usage: 'not_tested', agent: 'not_tested' });
const auth = (headers: Record<string, string>) => Object.keys(headers).some(h => !['content-type', 'accept'].includes(h.toLowerCase())) ? 'not_rejected' : 'not_required';
export interface DiscoveryObservation {
  providerId: string; source: 'engine-adapter/models'; discoveredAt: string;
  status: 'ok' | 'empty' | 'malformed' | 'http_error' | 'timeout' | 'cancelled' | 'unavailable' | 'unsupported' | 'missing_credentials';
  authState: string; complete: boolean; pages: number; detail: string;
  models: Array<{ providerId: string; modelId: string; source: string; discoveredAt: string; authState: string; capabilities: Record<string, never>; validation: ReturnType<typeof untested> }>;
}
export async function discoverCompatibleModels(t: ObservationTransport, opts: ChatOptions = {}): Promise<DiscoveryObservation> {
  const out: DiscoveryObservation = { providerId: t.id, source: 'engine-adapter/models', discoveredAt: new Date().toISOString(), status: 'unavailable', authState: 'unverified', complete: false, pages: 0, detail: 'Discovery unavailable', models: [] };
  try {
    return await guardedRequest(t.id, { ...opts, timeoutMs: Math.min(opts.timeoutMs ?? 8000, 8000) }, async signal => {
      const seen = new Set<string>(); const cursors = new Set<string>(); let cursor: string | undefined;
      for (let page = 0; page < 3; page++) {
        signal.throwIfAborted();
        const url = new URL(`${t.baseUrl}/models`); if (cursor) url.searchParams.set('after', cursor);
        const headers = t.headers();
        const res = await t.request(url.toString(), { headers, signal, redirect: 'error' });
        signal.throwIfAborted(); out.pages++;
        if (!res.ok) { void res.body?.cancel().catch(() => {}); out.status = 'http_error'; out.authState = [401, 403].includes(res.status) ? 'rejected' : 'unverified'; out.detail = `Models endpoint HTTP ${res.status}`; return out; }
        out.authState = auth(headers);
        let body: any;
        try { body = JSON.parse(await text(res, signal)); }
        catch (e) { signal.throwIfAborted(); out.status = 'malformed'; out.detail = 'Malformed or oversized model list'; return out; }
        signal.throwIfAborted();
        const rows = body?.data ?? body?.models;
        if (!Array.isArray(rows)) { out.status = 'malformed'; out.detail = 'Expected a model array'; return out; }
        for (const row of rows) {
          const id = row?.id ?? row?.name;
          if (typeof id !== 'string' || !id.trim() || id.length > 200 || /[\x00-\x1f\x7f]/.test(id)) { out.status = 'malformed'; out.detail = 'Invalid model identifier'; return out; }
          if (!seen.has(id)) {
            if (seen.size >= 200) { out.status = 'ok'; out.detail = 'Model limit reached; list is partial'; return out; }
            seen.add(id); out.models.push({ providerId: t.id, modelId: id, source: out.source, discoveredAt: out.discoveredAt, authState: out.authState, capabilities: {}, validation: untested() });
          }
        }
        // Only opaque cursors are accepted; never follow a provider-supplied URL.
        const next = body.next_cursor ?? (body.has_more === true ? body.last_id ?? rows.at(-1)?.id : undefined);
        if (body.next || body.links?.next || (body.has_more === true && !next)) { out.status = 'malformed'; out.detail = 'Unsupported pagination; URLs are not followed'; return out; }
        if (!next) { out.status = out.models.length ? 'ok' : 'empty'; out.complete = true; out.detail = out.models.length ? 'Observed model identifiers; capabilities not tested' : 'The endpoint returned an empty model list'; return out; }
        if (typeof next !== 'string' || next.length > 200 || /[\x00-\x1f]/.test(next) || cursors.has(next)) { out.status = 'malformed'; out.detail = 'Invalid or repeated pagination cursor'; return out; }
        cursors.add(next); cursor = next;
      }
      out.status = 'ok'; out.detail = 'Page limit reached; list is partial'; return out;
    });
  } catch (e) {
    out.status = isCancellation(e) ? 'cancelled' : isTimeout(e) ? 'timeout' : 'unavailable';
    out.detail = `Model discovery ${out.status}; configured choices were not changed`; return out;
  }
}

export async function validateCompatibleModel(t: ObservationTransport, capability: ValidationCapability, opts: ChatOptions = {}) {
  const out = { providerId: t.id, modelId: t.model, source: 'engine-adapter/round-trip', checkedAt: new Date().toISOString(), capability,
    status: 'failed', authState: 'unverified', inferenceVerified: false, billingVerified: false, agentValidated: false, validation: untested(), detail: 'Capability round trip failed' };
  out.validation[capability] = 'failed';
  try {
    return await guardedRequest(t.id, { ...opts, timeoutMs: Math.min(opts.timeoutMs ?? 8000, 8000) }, async signal => {
      const prompt = capability === 'jsonMode' ? 'Return exactly this JSON object: {"xr_validation":"XR_OK"}' : capability === 'toolUse' ? 'Call xr_validation_echo with value XR_OK. Do not do anything else.' : 'Reply with exactly XR_OK.';
      const body: Record<string, unknown> = { model: t.model, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 32, stream: capability === 'streaming' };
      if (capability === 'jsonMode') body.response_format = { type: 'json_object' };
      if (capability === 'toolUse') { body.tools = [{ type: 'function', function: { name: 'xr_validation_echo', description: 'Non-executing transport validation', parameters: { type: 'object', properties: { value: { type: 'string', enum: ['XR_OK'] } }, required: ['value'], additionalProperties: false } } }]; body.tool_choice = { type: 'function', function: { name: 'xr_validation_echo' } }; }
      const headers = t.headers();
      const res = await t.request(`${t.baseUrl}/chat/completions`, { method: 'POST', redirect: 'error', headers, body: JSON.stringify(body), signal });
      signal.throwIfAborted();
      if (!res.ok) { void res.body?.cancel().catch(() => {}); out.authState = [401, 403].includes(res.status) ? 'rejected' : 'unverified'; out.detail = `Round trip HTTP ${res.status}`; return out; }
      out.authState = auth(headers);
      const raw = await text(res, signal); signal.throwIfAborted(); let passed = false;
      if (capability === 'streaming') {
        if (res.headers.get('content-type')?.includes('text/event-stream')) {
          let content = '', finished = false;
          for (const line of raw.split(/\r?\n/).filter(l => l.startsWith('data:'))) {
            const data = line.slice(5).trim(); if (data === '[DONE]') { finished = true; continue; }
            const frame = JSON.parse(data); if (frame.error) throw new Error('SSE error');
            content += frame.choices?.[0]?.delta?.content ?? '';
            if (frame.choices?.[0]?.finish_reason === 'stop') finished = true;
          }
          passed = finished && content.trim() === 'XR_OK';
        }
      } else {
        const json = JSON.parse(raw); const message = json?.choices?.[0]?.message;
        if (json.error || !isChatCompletionObject(json) || !message) throw new Error('Malformed completion');
        if (capability === 'toolUse') { const calls = message?.tool_calls; const parsed = parseOpenAIToolCalls(calls); passed = Array.isArray(calls) && calls.length === 1 && calls[0].type === 'function' && typeof calls[0].id === 'string' && parsed.length === 1 && parsed[0].tool === 'xr_validation_echo' && parsed[0].args.value === 'XR_OK'; }
        else if (capability === 'jsonMode') passed = typeof message?.content === 'string' && JSON.parse(message.content).xr_validation === 'XR_OK';
        else if (capability === 'usage') passed = Number.isSafeInteger(json?.usage?.prompt_tokens) && json.usage.prompt_tokens >= 0 && Number.isSafeInteger(json?.usage?.completion_tokens) && json.usage.completion_tokens >= 0;
        else passed = typeof message?.content === 'string' && message.content.trim() === 'XR_OK';
      }
      out.validation[capability] = passed ? 'passed' : 'failed'; out.status = passed ? 'passed' : 'failed';
      out.inferenceVerified = passed && capability === 'chat';
      out.detail = passed ? 'Observed this capability only; not agent or billing certification' : 'Response did not satisfy the requested capability';
      return out;
    });
  } catch (e) { out.status = isCancellation(e) ? 'cancelled' : isTimeout(e) ? 'timeout' : 'failed'; out.detail = `Capability round trip ${out.status}`; return out; }
}
