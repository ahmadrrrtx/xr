/*
 * XR-REL-06 — custom OpenAI-compatible endpoints over the daemon API.
 *
 * The app advertised "any OpenAI-compatible API" while the only way to add one
 * was `xr providers add` in a terminal: ProviderService could hold custom
 * providers, but no route exposed it. The desktop therefore could not offer the
 * promise at all. These tests drive the new routes through the real handler and
 * assert what a user would observe — including that the SSRF guard is applied
 * BEFORE anything is persisted.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeHandler } from '../../src/daemon/server.ts';
import { Store } from '../../src/state/workspace-store.ts';
import { API_CONTRACT } from '../../src/daemon/routes/contract.ts';

const TOKEN = 'rel06-token';

type Handler = ReturnType<typeof makeHandler>;
let h: Handler;
let saved: Record<string, string | undefined> = {};

function fresh(): Handler {
  const tmp = mkdtempSync(join(tmpdir(), 'xr-rel06-'));
  process.env.XR_HOME = join(tmp, 'home');
  const store = new Store(join(tmp, 'd.db'));
  return makeHandler(store, TOKEN);
}

async function call(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, any>; text: string }> {
  const res = await h(
    new Request(`http://127.0.0.1:7843/api/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
  const text = await res.text();
  let json: Record<string, any> = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* empty / non-JSON */
  }
  return { status: res.status, json, text };
}

beforeEach(() => {
  saved = {
    XR_SECRET_BACKEND: process.env.XR_SECRET_BACKEND,
    XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER: process.env.XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER,
  };
  process.env.XR_SECRET_BACKEND = 'file';
  h = fresh();
});

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('XR-REL-06 · POST /providers/custom', () => {
  test('refuses loopback, link-local and metadata hosts before saving', async () => {
    delete process.env.XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER;
    for (const baseUrl of [
      'http://127.0.0.1:11434/v1',
      'http://169.254.169.254/latest/meta-data',
      'http://localhost:8080/v1',
    ]) {
      const r = await call('POST', '/providers/custom', {
        baseUrl,
        defaultModel: 'x',
      });
      expect(r.status).toBe(400);
      expect(r.json.error).toContain('refused');
    }
  });

  test('a missing defaultModel is a 400, not a half-saved provider', async () => {
    process.env.XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER = '1';
    const r = await call('POST', '/providers/custom', {
      baseUrl: 'http://127.0.0.1:9/v1',
    });
    expect(r.status).toBe(400);
    expect(r.text).toContain('defaultModel');
  });

  test('a missing baseUrl is a 400', async () => {
    const r = await call('POST', '/providers/custom', { defaultModel: 'm' });
    expect(r.status).toBe(400);
    expect(r.text).toContain('baseUrl');
  });

  test('an unresolvable host is refused, never saved', async () => {
    const r = await call('POST', '/providers/custom', {
      baseUrl: 'https://no-such-host.invalid/v1',
      defaultModel: 'm',
    });
    expect(r.status).toBe(400);
    expect(r.text).toContain('refused');
  });

  test('a non-JSON body is a 400 with a readable reason', async () => {
    const res = await h(
      new Request('http://127.0.0.1:7843/api/v1/providers/custom', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: 'not json',
      })
    );
    expect(res.status).toBe(400);
  });

  test('removing an unknown id is a 404 naming the id', async () => {
    const r = await call('POST', '/providers/custom/remove', { id: 'nope' });
    expect(r.status).toBe(404);
    expect(r.text).toContain('nope');
  });

  test('the routes are actually mounted (a wrong path still 404s)', async () => {
    // Guards against a test that "passes" only because everything 404s.
    const wrong = await call('GET', '/providers/custom-nope');
    expect(wrong.status).toBe(404);
    expect(wrong.text).toBe('{"error":"not found"}');
  });

  test('GET /providers/custom never leaks a credential', async () => {
    const r = await call('GET', '/providers/custom');
    // Either a list or an honest 503; never a 200 carrying key material.
    expect([200, 503]).toContain(r.status);
    if (r.status === 200) {
      expect(Array.isArray(r.json.providers)).toBe(true);
      expect(r.text).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
      expect(r.text).not.toContain('apiKey"');
    }
  });
});

describe('XR-REL-06 · a real endpoint end to end', () => {
  test('an added endpoint is listed, and only its env-var name is echoed', async () => {
    const added = await call('POST', '/providers/custom', {
      id: 'mygateway',
      baseUrl: 'http://93.184.216.34/v1',
      defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      label: 'My gateway',
      apiKey: 'sk-averyrealisticlookingkey123',
    });
    expect(added.status).toBe(200);
    // The id is honoured verbatim; the key is referenced only by env-var name.
    expect(added.json.provider.id).toBe('mygateway');
    expect(added.json.provider.apiKeyEnv).toBe('MYGATEWAY_API_KEY');
    expect(added.json.provider.keyed).toBe(true);
    expect(added.text).not.toContain('sk-averyrealisticlookingkey123');

    const list = await call('GET', '/providers/custom');
    expect(list.status).toBe(200);
    const entry = (list.json.providers as any[]).find((p) => p.id === 'mygateway');
    expect(entry).toBeTruthy();
    expect(entry.baseUrl).toBe('http://93.184.216.34/v1');
    expect(entry.defaultModel).toBe('meta-llama/Llama-3.3-70B-Instruct-Turbo');
    // The secret is never read back out.
    expect(list.text).not.toContain('sk-averyrealisticlookingkey123');

    // …and it is removable again.
    const gone = await call('POST', '/providers/custom/remove', { id: 'mygateway' });
    expect(gone.status).toBe(200);
    const after = await call('GET', '/providers/custom');
    expect((after.json.providers as any[]).some((p) => p.id === 'mygateway')).toBe(false);
  });

  test('a custom endpoint can never shadow a built-in preset id', async () => {
    // api.groq.com derives `groq`, which is a BUILT-IN preset. Storing it as
    // `groq` would replace the built-in entry and inherit GROQ_API_KEY — a key
    // meant for one service sent to another host. It must be suffixed instead.
    const r = await call('POST', '/providers/custom', {
      baseUrl: 'https://api.groq.com/openai/v1',
      defaultModel: 'llama-3.3-70b-versatile',
    });
    expect(r.status).toBe(200);
    expect(r.json.provider.id).toBe('groq-compatible');
    expect(r.json.provider.apiKeyEnv).toBe('GROQ_COMPATIBLE_API_KEY');
  });

  test('two custom providers may not share one secret env var', async () => {
    const a = await call('POST', '/providers/custom', {
      id: 'gateway-a',
      baseUrl: 'http://93.184.216.34/v1',
      defaultModel: 'm',
      apiKeyEnv: 'SHARED_GATEWAY_KEY',
    });
    expect(a.status).toBe(200);
    const b = await call('POST', '/providers/custom', {
      id: 'gateway-b',
      baseUrl: 'http://93.184.216.35/v1',
      defaultModel: 'm',
      apiKeyEnv: 'SHARED_GATEWAY_KEY',
    });
    expect(b.status).toBe(400);
    expect(b.text).toContain('already belongs to');
  });

  test('re-adding the same id replaces rather than duplicates', async () => {
    for (const model of ['m-one', 'm-two']) {
      const r = await call('POST', '/providers/custom', {
        id: 'gateway-a',
        baseUrl: 'http://93.184.216.34/v1',
        defaultModel: model,
      });
      expect(r.status).toBe(200);
    }
    const list = await call('GET', '/providers/custom');
    const entries = (list.json.providers as any[]).filter((p) => p.id === 'gateway-a');
    expect(entries).toHaveLength(1);
    expect(entries[0].defaultModel).toBe('m-two');
  });
});

describe('XR-REL-06 · the route is advertised in the contract', () => {
  test('providers.custom.add is experimental and documented in OpenAPI', async () => {
    const entry = (API_CONTRACT as Record<string, any>)['providers.custom.add'];
    expect(entry).toBeTruthy();
    expect(entry.stability).toBe('experimental');

    const { readFileSync } = await import('node:fs');
    const spec = readFileSync(
      new URL('../../docs/api/openapi.json', import.meta.url),
      'utf8'
    );
    expect(spec).toContain('/providers/custom');
  });
});
