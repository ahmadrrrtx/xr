import { expect, test } from 'bun:test';
import { discoverCompatibleModels, validateCompatibleModel, type ObservationTransport, type ValidationCapability } from '../../src/providers/observations';
const transport = (request: ObservationTransport['request']): ObservationTransport => ({ id: 'fixture', model: 'owner/chosen-model', baseUrl: 'https://fixture.invalid/v1', headers: () => ({ Authorization: 'Bearer fixture-observation-secret' }), request });
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
test('bounded pages preserve identity/provenance and never infer capabilities from listing', async () => {
  const urls: URL[] = [];
  const out = await discoverCompatibleModels(transport(async url => {
    urls.push(new URL(url)); return Response.json(urls.length === 1 ? { data: [{ id: 'a' }], has_more: true, last_id: 'a' } : { data: [{ id: 'a' }, { id: 'b' }] });
  }));
  expect(urls[1].searchParams.get('after')).toBe('a'); expect(out.status).toBe('ok'); expect(out.complete).toBe(true);
  expect(out.models.map(m => m.modelId)).toEqual(['a', 'b']); expect(out.models.every(m => m.providerId === 'fixture' && m.discoveredAt === out.discoveredAt)).toBe(true);
  expect(out.models[0].capabilities).toEqual({}); expect(Object.values(out.models[0].validation).every(v => v === 'not_tested')).toBe(true);
  expect(JSON.stringify(out)).not.toContain('fixture-observation-secret');
});
for (const [name, body, status] of [
  ['empty', { data: [] }, 'empty'], ['numeric id', { data: [{ id: 5 }] }, 'malformed'], ['object id', { data: [{ id: {} }] }, 'malformed'],
  ['alternate error shape', { detail: 'fixture-observation-secret' }, 'malformed'], ['no rows', {}, 'malformed'],
  ['pagination URL', { data: [{ id: 'a' }], next: 'http://169.254.169.254/secret' }, 'malformed'],
] as const) test(`discovery reports ${name}, never a fabricated empty success`, async () => {
  let calls = 0; const result = await discoverCompatibleModels(transport(async () => { calls++; return Response.json(body); }));
  expect(result.status).toBe(status); expect(calls).toBe(1); expect(JSON.stringify(result)).not.toContain('fixture-observation-secret');
});
test('non-OpenAI HTTP errors have auth/status evidence but never echo upstream secrets', async () => {
  const result = await discoverCompatibleModels(transport(async () => new Response('fixture-observation-secret', { status: 403 })));
  expect(result.status).toBe('http_error'); expect(result.authState).toBe('rejected'); expect(JSON.stringify(result)).not.toContain('fixture-observation-secret');
});
test('repeated cursors, page/model limits and oversized bodies are bounded and partial', async () => {
  const repeat = await discoverCompatibleModels(transport(async () => Response.json({ data: [{ id: 'a' }], has_more: true, last_id: 'a' })));
  expect(repeat.status).toBe('malformed'); expect(repeat.pages).toBe(2);
  let pages = 0; const page = await discoverCompatibleModels(transport(async () => Response.json({ data: [{ id: String(++pages) }], has_more: true, last_id: String(pages) })));
  expect(page.pages).toBe(3); expect(page.complete).toBe(false);
  const models = await discoverCompatibleModels(transport(async () => Response.json({ data: Array.from({ length: 201 }, (_, i) => ({ id: `m${i}` })) })));
  expect(models.models.length).toBe(200); expect(models.complete).toBe(false);
  const huge = await discoverCompatibleModels(transport(async () => new Response('x'.repeat(256 * 1024 + 1))));
  expect(huge.status).toBe('malformed');
});
test('one deadline spans pages and stalled bodies; cancellation prevents or stops requests', async () => {
  let pages = 0;
  const result = await discoverCompatibleModels(transport(async () => { await wait(18); return Response.json({ data: [{ id: String(++pages) }], has_more: true, last_id: String(pages) }); }), { timeoutMs: 28 });
  expect(result.status).toBe('timeout'); expect(result.pages).toBeLessThan(3);
  const stalled = await discoverCompatibleModels(transport(async () => new Response(new ReadableStream({ start() {} }))), { timeoutMs: 15 });
  expect(stalled.status).toBe('timeout');
  const c = new AbortController(); c.abort(); let calls = 0;
  const cancelled = await discoverCompatibleModels(transport(async () => { calls++; return Response.json({ data: [] }); }), { signal: c.signal });
  expect(cancelled.status).toBe('cancelled'); expect(calls).toBe(0);
});
for (const capability of ['chat', 'streaming', 'toolUse', 'jsonMode', 'usage'] as const) {
  test(`a ${capability} round trip verifies only that requested capability, without tool execution`, async () => {
    let sent: any;
    const out = await validateCompatibleModel(transport(async (_url, init) => {
      sent = JSON.parse(String(init.body));
      if (capability === 'streaming') return new Response('data: {"choices":[{"delta":{"content":"XR_OK"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
      return Response.json({ choices: [{ message: { content: capability === 'jsonMode' ? '{"xr_validation":"XR_OK"}' : 'XR_OK', ...(capability === 'toolUse' ? { tool_calls: [{ id: 'call_fixture', type: 'function', function: { name: 'xr_validation_echo', arguments: '{"value":"XR_OK"}' } }] } : {}) } }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
    }), capability);
    expect(sent.model).toBe('owner/chosen-model'); expect(out.status).toBe('passed'); expect(out.validation[capability]).toBe('passed');
    expect(out.agentValidated).toBe(false); expect(out.billingVerified).toBe(false);
    for (const other of ['chat', 'streaming', 'toolUse', 'jsonMode', 'usage'] as ValidationCapability[]) if (other !== capability) expect(out.validation[other]).toBe('not_tested');
  });
}
test('a successful model list or JSON chat response cannot masquerade as streaming/tools/structured output', async () => {
  const t = transport(async () => Response.json({ choices: [{ message: { content: 'XR_OK' } }] }));
  for (const capability of ['streaming', 'toolUse', 'jsonMode', 'usage'] as const) expect((await validateCompatibleModel(t, capability)).status).toBe('failed');
});
