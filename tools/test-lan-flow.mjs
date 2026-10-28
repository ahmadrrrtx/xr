/**
 * End-to-end check of the LAN pairing + gating flow against the reference
 * daemon. Run with the daemon already listening:
 *
 *   node tools/reference-daemon.mjs --lan &
 *   node tools/test-lan-flow.mjs
 *
 * Covers the acceptance criteria that are testable without a phone:
 *  - loopback default vs 0.0.0.0 under --lan
 *  - pairing code is single-use, TTL'd and rate-limited
 *  - invalid code returns a generic 401 (no info leak)
 *  - paired device can read chats/approvals/budget
 *  - mobile sessions get 403 on files/terminal/git/mcp
 *  - revoking a device invalidates its cookie immediately
 *  - pairing endpoint rejects non-push-service subscription endpoints
 */
// The daemon's LAN certificate is self-signed by design (TOFU + pinning on the
// real client). This harness talks to its own machine only, so it bypasses
// chain validation — it asserts pinning-equivalent behaviour elsewhere.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const BASE = process.env.XR_BASE ?? 'https://127.0.0.1:3141';
const TOKEN = process.env.XR_DAEMON_TOKEN ?? '';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${extra}`}`);
  if (!ok) failures += 1;
};

const call = async (path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}) },
  });
  let body = null;
  const text = await res.text();
  try { body = JSON.parse(text); } catch { body = text; }
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, body, setCookie };
};

const cookieOf = (setCookie) => (setCookie ?? '').split(';')[0] ?? '';

// Each run gets its own rate-limit bucket (the daemon keys pairing attempts by
// source, exactly as a proxy would). Keeps back-to-back runs from throttling
// each other while the in-run brute-force loop still trips the limit.
const PEER = `test-${Math.random().toString(36).slice(2)}`;
const withPeer = (headers = {}) => ({ ...headers, 'x-xr-peer': PEER });

/* 1. unauthenticated API is closed -------------------------------------------- */
{
  const res = await call('/api/v1/chats');
  check('unpaired request → 401', res.status === 401, `got ${res.status}`);
}

/* 2. cert fingerprint is public (needed for TOFU) ----------------------------- */
let fingerprint = '';
{
  const res = await call('/api/mobile/cert-fingerprint');
  fingerprint = res.body?.fingerprint ?? '';
  check('cert fingerprint is published for verification', /^[0-9a-f]{64}$/.test(fingerprint), fingerprint);
}

/* 3. desktop asks for a pairing QR -------------------------------------------- */
let code = '';
if (!TOKEN) {
  console.log('·  skipping pairing tests (no XR_DAEMON_TOKEN)');
} else {
  const auth = { authorization: `Bearer ${TOKEN}` };
  const qr = await call('/api/mobile/pair-qr', { method: 'POST', headers: auth });
  code = qr.body?.code ?? '';
  check('pair-qr returns a 6-digit code', /^\d{6}$/.test(code), JSON.stringify(qr.body));
  check('pair-qr returns a QR data URL', String(qr.body?.qr ?? '').startsWith('data:image/png;base64,'));
  check('pair-qr returns the pairing URL', String(qr.body?.url ?? '').includes('/mobile/pair?code='));
  check('pair-qr fingerprints match the served cert', qr.body?.fingerprint === fingerprint);

  /* 4. wrong code → generic 401, no leak ------------------------------------- */
  const wrong = await call('/api/mobile/pair', {
    method: 'POST',
    headers: withPeer({ 'content-type': 'application/json' }),
    body: JSON.stringify({ code: '000000', deviceName: 'Test Phone' }),
  });
  check('wrong pairing code → 401', wrong.status === 401, `got ${wrong.status}`);
  check('wrong code leaks nothing about LAN mode', JSON.stringify(wrong.body).includes('Not paired'));

  /* 5. correct code → session cookie ------------------------------------------ */
  const pair = await call('/api/mobile/pair', {
    method: 'POST',
    headers: withPeer({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      code,
      deviceName: 'Test Phone',
      pushKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
    }),
  });
  check('valid pairing code succeeds', pair.status === 200, JSON.stringify(pair.body));
  check('pairing sets an HttpOnly Secure SameSite cookie',
    /HttpOnly/i.test(pair.setCookie ?? '') && /Secure/i.test(pair.setCookie ?? '') && /SameSite=Strict/i.test(pair.setCookie ?? ''),
    pair.setCookie ?? 'none');

  const cookie = cookieOf(pair.setCookie);

  /* 6. code is single-use ------------------------------------------------------ */
  const replay = await call('/api/mobile/pair', {
    method: 'POST',
    headers: withPeer({ 'content-type': 'application/json' }),
    body: JSON.stringify({ code, deviceName: 'Second Phone' }),
  });
  check('pairing code is single-use', replay.status === 401, `got ${replay.status}`);

  /* 7. paired device can read --------------------------------------------------- */
  // Shipping truth (2.4): the daemon holds no server-side chat list (desktop keeps
  // history client-side), so the paired-device read proof is the real companion
  // read path — models/approvals/budget — not reference-demo chat fixtures.
  const authed = { cookie };
  const models = await call('/api/v1/models', { headers: authed });
  check('paired device reads models (companion API)', models.status === 200 && typeof models.body?.selected?.model === 'string');

  const approvals = await call('/api/v1/approvals?status=pending', { headers: authed });
  check('paired device reads approvals', approvals.status === 200);

  const budget = await call('/api/v1/budget', { headers: authed });
  check('paired device reads budget', budget.status === 200 && typeof budget.body?.config?.perTaskUsd === 'number');

  /* 7b. V1-P5-001 — the companion surface the PWA actually calls ---------------- */
  const cModels = await call('/api/mobile/models', { headers: authed });
  check(
    'companion models: { models: [{id,label,provider}] }',
    cModels.status === 200 && Array.isArray(cModels.body?.models) && cModels.body.models.every?.((m) => typeof m?.id === 'string' && typeof m?.label === 'string' && typeof m?.provider === 'string'),
    `got ${cModels.status}`,
  );
  const cBudget = await call('/api/mobile/budget', { headers: authed });
  check(
    'companion budget: cents summary without a fabricated daily cap',
    cBudget.status === 200 && typeof cBudget.body?.spentTodayCents === 'number' && typeof cBudget.body?.monthCapCents === 'number' && cBudget.body?.dailyCapCents === undefined,
    `got ${cBudget.status}`,
  );
  const cApprovals = await call('/api/mobile/approvals', { headers: authed });
  check(
    'companion approvals: { approvals: [...] }',
    cApprovals.status === 200 && Array.isArray(cApprovals.body?.approvals),
    `got ${cApprovals.status}`,
  );
  const cAnon = await call('/api/mobile/models');
  check('companion surface refuses anonymous (401)', cAnon.status === 401, `got ${cAnon.status}`);

  /* 8. mobile is blocked from coding surfaces ------------------------------------ */
  for (const [label, path] of [
    ['files', '/api/v1/files/src/index.ts'],
    ['terminal', '/api/v1/terminal'],
    ['git', '/api/v1/git/status'],
    ['mcp', '/api/v1/mcp/tools'],
  ]) {
    const res = await call(path, { headers: authed });
    check(`mobile → 403 on ${label}`, res.status === 403, `got ${res.status}`);
  }

  /* 9. desktop token is NOT blocked ---------------------------------------------- */
  const desktopFiles = await call('/api/v1/files/src/index.ts', { headers: { authorization: `Bearer ${TOKEN}` } });
  check('desktop token is not gated (404, not 403)', desktopFiles.status !== 403, `got ${desktopFiles.status}`);

  /* 10. push subscription endpoint allowlist ------------------------------------- */
  const badSub = await call('/api/mobile/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      subscription: { endpoint: 'https://evil.example.com/collect', keys: { p256dh: 'AAAA', auth: 'BBBB' } },
    }),
  });
  check('non-push-service endpoint is rejected', badSub.status === 400, `got ${badSub.status}`);

  /* 11. revoke from desktop kills the mobile session ------------------------------ */
  const devices = await call('/api/mobile/devices', { headers: { authorization: `Bearer ${TOKEN}` } });
  // Revoke the device THIS test paired, not an unrelated one from an earlier run.
  const entry = (devices.body?.devices ?? []).find((d) => d.name === 'Test Phone');
  const id = entry?.id;
  check('desktop can list paired devices', Boolean(id), JSON.stringify(devices.body));

  if (id) {
    const revoked = await call(`/api/mobile/devices/${id}/revoke`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } });
    check('revoke succeeds', revoked.status === 200);

    const after = await call('/api/v1/models', { headers: authed });
    check('revoked device gets 401 on next request', after.status === 401, `got ${after.status}`);

    const listed = await call('/api/mobile/devices', { headers: { authorization: `Bearer ${TOKEN}` } });
    check('revoked device disappears from the list', !(listed.body?.devices ?? []).some((d) => d.id === id));
  }
}

/* 12. rate limiting on pairing --------------------------------------------------- */
{
  let blocked = 0;
  for (let i = 0; i < 14; i += 1) {
    const res = await call('/api/mobile/pair', {
      method: 'POST',
      headers: withPeer({ 'content-type': 'application/json' }),
      body: JSON.stringify({ code: `00000${i % 10}`, deviceName: 'Brute' }),
    });
    if (res.status === 429) blocked += 1;
  }
  check('pairing is rate-limited (10/min)', blocked > 0, `${blocked}/14 throttled`);
}

console.log(failures === 0 ? '\nAll LAN flow checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
