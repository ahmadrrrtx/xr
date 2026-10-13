#!/usr/bin/env node
/**
 * XR reference daemon for Phase 28.
 *
 * This exists so the mobile PWA can be exercised end-to-end without the full
 * Phase 0–27 daemon: it implements the exact route surface the mobile client
 * consumes, over the real LAN-mode TLS + pairing + gating modules from
 * src/daemon/. It is a test harness, NOT the shipping daemon — the real one
 * keeps its own routes and simply mounts `handleMobileRoutes`.
 *
 *   node tools/build-daemon.mjs
 *   node tools/reference-daemon.mjs --lan [--port 3141]
 */

import { createServer } from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';

import { ensureLanCert, lanAddresses, lanUrl } from './.daemon-build/lan-tls.mjs';
import { listDevices, revokeDevice, devicesWithPush } from './.daemon-build/mobile-devices.mjs';
import {
  handleMobileRoutes,
  resolveSession,
  mobileGate,
  originAllowed,
  setQrRenderer,
  pairingUrl,
  createPairingCode,
} from './.daemon-build/mobile-pairing.mjs';
import { sendPush, vapidPublicKey, DEFAULT_TTL_SECONDS } from './.daemon-build/web-push.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const DIST = resolve(root, 'mobile/dist');

/* ------------------------------------------------------------------- config --- */

const args = process.argv.slice(2);
const LAN = args.includes('--lan') || process.env.XR_DAEMON_LAN === '1';
const PORT = Number(process.env.XR_DAEMON_PORT ?? 3141);
const HOST = LAN ? '0.0.0.0' : '127.0.0.1';
const VERSION = '28.0.0';
const DAEMON_TOKEN = process.env.XR_DAEMON_TOKEN ?? randomBytes(24).toString('base64url');

const cert = LAN ? await ensureLanCert(PORT) : null;
const LOCAL_URL = LAN ? lanUrl(PORT) : `http://127.0.0.1:${PORT}`;

const ctx = {
  lan: LAN,
  fingerprint: cert?.fingerprint ?? '',
  lanUrl: LOCAL_URL,
  version: VERSION,
  daemonToken: DAEMON_TOKEN,
};

setQrRenderer(async (text) => QRCode.toDataURL(text, { width: 560, margin: 1, color: { dark: '#03070D', light: '#FFFFFF' } }));

/* ------------------------------------------------------------- demo dataset --- */

const now = Date.now();
const minute = 60_000;
const hour = 60 * minute;

const CHATS = [
  {
    id: 'cht_budget',
    title: 'Trim the embedding spend',
    updatedAt: now - 8 * minute,
    lastMessage: 'Switching to the local model saves about $4.10 a day at your volume.',
    unread: 0,
  },
  {
    id: 'cht_ci',
    title: 'Why is CI flaky on Mondays?',
    updatedAt: now - 52 * minute,
    lastMessage: 'It’s the cache warming job colliding with the nightly snapshot.',
    unread: 1,
  },
  {
    id: 'cht_auth',
    title: 'Auth middleware refactor',
    updatedAt: now - 5 * hour,
    lastMessage: 'I sketched the change but it touches three call sites — want a diff?',
    unread: 0,
  },
  {
    id: 'cht_notes',
    title: 'Voice notes',
    updatedAt: now - 26 * hour,
    lastMessage: 'Remind me to review the deploy checklist.',
    unread: 0,
  },
];

const MESSAGES = {
  cht_budget: [
    { id: 'm1', chatId: 'cht_budget', role: 'user', content: 'How much did we spend on embeddings today?', createdAt: now - 14 * minute },
    {
      id: 'm2',
      chatId: 'cht_budget',
      role: 'assistant',
      content:
        'You’ve spent **$3.82** today, almost all of it embeddings on `text-embedding-3-small`.\n\nAt your current rate that lands at **$114/month**. Two easy wins:\n\n```ts\n// src/lib/embeddings.ts\nconst cache = new Map<string, number[]>();\n\nexport async function embed(text: string) {\n  const key = hash(text);\n  const hit = cache.get(key);\n  if (hit) return hit;\n  const vector = await provider.embed(text);\n  cache.set(key, vector);\n  return vector;\n}\n```\n\nThat alone removes ~38% of duplicate calls in your workload.',
      createdAt: now - 13 * minute,
    },
    { id: 'm3', chatId: 'cht_budget', role: 'user', content: 'What if I use the local model instead?', createdAt: now - 9 * minute },
    {
      id: 'm4',
      chatId: 'cht_budget',
      role: 'assistant',
      content:
        'Switching to the local model saves about $4.10 a day at your volume.\n\n| Model | Cost / 1M tokens | Quality on your evals |\n| --- | --- | --- |\n| text-embedding-3-small | $0.02 | 0.81 |\n| nomic-embed-text (local) | $0.00 | 0.78 |\n\nThe 3-point quality drop didn’t change retrieval recall in my test — worth trying for a week.',
      createdAt: now - 8 * minute,
    },
  ],
  cht_ci: [
    { id: 'm5', chatId: 'cht_ci', role: 'user', content: 'CI only fails on Monday mornings. Any idea?', createdAt: now - 58 * minute },
    {
      id: 'm6',
      chatId: 'cht_ci',
      role: 'assistant',
      content:
        'It’s the cache warming job colliding with the nightly snapshot.\n\n```bash\n# .github/workflows/ci.yml — the 03:00 job\n0 3 * * 1  npm run warm-cache      # Monday 03:00\n0 3 * * *  npm run nightly-snapshot # daily 03:00\n```\n\nBoth grab the same S3 prefix. Move warming to 03:40 and the flake disappears.',
      createdAt: now - 52 * minute,
    },
  ],
  cht_auth: [
    { id: 'm7', chatId: 'cht_auth', role: 'user', content: 'Can we drop the legacy session shim?', createdAt: now - 5 * hour },
    {
      id: 'm8',
      chatId: 'cht_auth',
      role: 'assistant',
      content:
        'I sketched the change but it touches three call sites — want a diff?\n\n- `src/middleware/auth.ts`\n- `src/routes/admin.ts`\n- `src/routes/billing.ts`\n\nI’d rather show you the diff than apply it blind.',
      createdAt: now - 5 * hour + minute,
    },
  ],
  cht_notes: [
    { id: 'm9', chatId: 'cht_notes', role: 'user', content: '🎤 Remind me to review the deploy checklist.', createdAt: now - 26 * hour, viaVoice: true },
    {
      id: 'm10',
      chatId: 'cht_notes',
      role: 'assistant',
      content: 'Noted. The deploy checklist lives in `docs/deploy.md` — last edited 4 days ago, 9 items, 2 still unchecked.',
      createdAt: now - 26 * hour + minute,
    },
  ],
};

const APPROVALS = [
  {
    id: 'apr_7f21',
    title: 'Run npm test',
    summary: 'Execute the full unit suite in ~/code/xr-api. Takes about 90 seconds, no network calls.',
    workspace: 'xr-api',
    createdAt: now - 3 * minute,
    status: 'pending',
    budgetCents: 0,
    language: 'bash',
    diff: 'diff --git a/package.json b/package.json\nindex 8f2a1c4..b91d3e7 100644\n--- a/package.json\n+++ b/package.json\n@@ -14,7 +14,7 @@\n   "scripts": {\n-    "test": "jest --silent",\n+    "test": "jest --silent --coverage",\n     "lint": "eslint ."\n   }',
  },
  {
    id: 'apr_2c90',
    title: 'Write src/middleware/auth.ts',
    summary: 'Apply the session-shim removal we discussed. 34 lines changed across one file.',
    workspace: 'xr-api',
    createdAt: now - 21 * minute,
    status: 'pending',
    budgetCents: 12,
    language: 'ts',
    diff: 'diff --git a/src/middleware/auth.ts b/src/middleware/auth.ts\nindex 331aa02..77c1de4 100644\n--- a/src/middleware/auth.ts\n+++ b/src/middleware/auth.ts\n@@ -8,12 +8,9 @@\n-import { legacySessionShim } from "../compat/legacy";\n import { verifyToken } from "../lib/jwt";\n \n export async function auth(req: Request) {\n-  if (legacySessionShim(req)) return req.session;\n   const token = req.headers.get("authorization");\n   return verifyToken(token);\n }',
  },
  {
    id: 'apr_11ab',
    title: 'Deploy api to staging',
    summary: 'Push the current branch to the staging environment behind the feature flag.',
    workspace: 'xr-infra',
    createdAt: now - 4 * hour,
    status: 'approved',
    resolvedAt: now - 4 * hour + 6 * minute,
    budgetCents: 0,
  },
  {
    id: 'apr_55ff',
    title: 'Install dependency: zod',
    summary: 'Add zod for request validation (MIT, no transitive deps).',
    workspace: 'xr-api',
    createdAt: now - 27 * hour,
    status: 'denied',
    resolvedAt: now - 27 * hour + 40_000,
    budgetCents: 0,
  },
];

const MODELS = [
  { id: 'claude-opus-4-5', label: 'Claude Opus 4.5', provider: 'Anthropic' },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', provider: 'Anthropic' },
  { id: 'gpt-5', label: 'GPT-5', provider: 'OpenAI' },
  { id: 'llama-3.3-70b-local', label: 'Llama 3.3 70B (local)', provider: 'Ollama', local: true },
  { id: 'qwen2.5-coder-32b-local', label: 'Qwen 2.5 Coder 32B (local)', provider: 'Ollama', local: true },
];

const BUDGET = {
  spentTodayCents: 382,
  dailyCapCents: 500,
  spentMonthCents: 6140,
  monthCapCents: 15000,
  currency: 'USD',
};

/* ------------------------------------------------------------------ helpers --- */

const json = (res, body, status = 200, extra = {}) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...extra,
  });
  res.end(payload);
};

const CSP = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "script-src 'self'",
  "connect-src 'self' wss: https://*.googleapis.com https://*.push.apple.com https://updates.push.services.mozilla.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "font-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

async function serveStatic(req, res, pathname) {
  // /mobile/* -> mobile/dist/*
  const relative = pathname.replace(/^\/mobile\/?/, '') || 'index.html';
  const safe = normalize(relative).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(DIST, safe);

  if (!filePath.startsWith(DIST)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // SPA fallback for /mobile/<anything>
    filePath = join(DIST, 'index.html');
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'content-length': body.length,
      'content-security-policy': CSP,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cross-origin-opener-policy': 'same-origin',
      'service-worker-allowed': '/mobile/',
      'cache-control': filePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}

/** Stream a canned-but-plausible reply, token by token. */
function streamReply(req, res, prompt) {
  const replies = [
    `Here’s what I found. ${prompt.length > 40 ? 'Short answer first: ' : ''}the local model handles this fine, and it keeps the bytes on your machine.\n\n`,
    'I looked at the three call sites you mentioned. Two are trivial, one needs a decision from you — the admin route still relies on the shim for long-lived sessions.\n\n',
    'Want me to prepare the diff? I won’t apply it until you approve.\n\n',
  ];
  const text = replies.join('');
  const tokens = text.match(/\S+\s*/g) ?? [text];

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  let index = 0;
  // NB: check the RESPONSE, not the request. Node marks `req.destroyed` true as
  // soon as the request body has been fully read, so guarding on `req` here
  // cancels the stream before the first token is ever written.
  const stop = () => {
    clearInterval(timer);
  };
  // NB: do NOT listen on `req` — Node emits 'close' on the IncomingMessage as
  // soon as the body is consumed, which would cancel the stream instantly.
  res.on('close', stop);

  const timer = setInterval(() => {
    if (res.destroyed || res.writableEnded) {
      stop();
      return;
    }
    if (index >= tokens.length) {
      res.write(`event: done\ndata: ${JSON.stringify({ messageId: `m_${randomUUID()}` })}\n\n`);
      stop();
      res.end();
      return;
    }
    // Burst a few tokens per tick so it feels like a real model.
    const chunk = tokens.slice(index, index + 3).join('');
    index += 3;
    res.write(`event: token\ndata: ${JSON.stringify({ text: chunk })}\n\n`);
  }, 28);
}

/**
 * Adapt a Node IncomingMessage to the small subset of the Fetch API the daemon
 * modules use (headers.get / .json / .url). The real daemon runs under
 * Bun.serve(), which hands it a real Request — this shim exists only so the
 * reference daemon can reuse the exact same modules.
 */
function toFetchRequest(req, url) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) for (const item of value) headers.set(key, item);
  }
  // Source identity for pairing rate limits (same role as X-Forwarded-For).
  if (!headers.has('x-xr-peer')) {
    const remote = req.socket?.remoteAddress;
    if (remote) headers.set('x-xr-peer', remote);
  }
  let cachedBody = null;
  const body = async () => {
    if (cachedBody === null) cachedBody = await readBody(req);
    return cachedBody;
  };
  return {
    method: req.method ?? 'GET',
    url: url.toString(),
    headers,
    json: async () => JSON.parse((await body()) || '{}'),
    text: body,
  };
}

/* ------------------------------------------------------------------- server --- */

const server = createServer(
  cert ? { key: cert.key, cert: cert.cert } : {},
  async (req, res) => {
    // Derive the request origin from the Host header so proxies (and the
    // desktop webview) compare correctly against the Origin header.
    const hostHeader = req.headers.host;
    const requestOrigin = hostHeader
      ? `${cert ? 'https' : 'http'}://${hostHeader}`
      : LOCAL_URL;
    const url = new URL(req.url ?? '/', requestOrigin);
    const { pathname, searchParams } = url;

    // Basic hardening headers on everything.
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');

    /* static PWA ---------------------------------------------------------- */
    if (pathname.startsWith('/mobile') || pathname === '/manifest.webmanifest') {
      await serveStatic(req, res, pathname);
      return;
    }
    if (pathname === '/' || pathname === '') {
      res.writeHead(302, { location: '/mobile/' }).end();
      return;
    }

    /* session + gating ----------------------------------------------------- */
    const request = toFetchRequest(req, url);
    const session = await resolveSession(request, ctx);

    if (req.method !== 'GET' && req.method !== 'HEAD' && !originAllowed(request, session)) {
      json(res, { error: 'Bad origin' }, 403);
      return;
    }

    const mobileRoutes = await handleMobileRoutes(request, url, session, {
      ctx,
      vapidPublicKey,
      sendTestPush: async (device) => {
        const result = await sendPush(
          device,
          { title: 'XR test push', body: 'Push is working — your phone is paired.', ts: Date.now() },
          DEFAULT_TTL_SECONDS,
        );
        return result.ok;
      },
    });
    if (mobileRoutes) {
      const setCookie = mobileRoutes.headers.get('set-cookie');
      const body = await mobileRoutes.text();
      res.writeHead(mobileRoutes.status, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...(setCookie ? { 'set-cookie': setCookie } : {}),
      });
      res.end(body);
      return;
    }

    /* authenticated API --------------------------------------------------- */
    const authed = session.privileged || Boolean(session.device);
    // The mobile app probes /api/meta/version to detect a revoked session, so
    // it must be gated exactly like the rest of the API.
    if (!authed && (pathname.startsWith('/api/v1/') || pathname === '/api/meta/version')) {
      json(res, { error: 'Not paired' }, 401);
      return;
    }

    const gate = mobileGate(pathname, session);
    if (gate) {
      json(res, { error: gate }, 403);
      return;
    }

    switch (true) {
      case pathname === '/api/meta/version':
        json(res, { version: VERSION, host: LOCAL_URL, lan: LAN, deviceName: 'XR desktop' });
        return;

      case pathname === '/api/v1/models':
        json(res, { models: MODELS });
        return;

      case pathname === '/api/v1/budget':
        json(res, BUDGET);
        return;

      case pathname === '/api/v1/chats' && req.method === 'GET':
        json(res, { chats: CHATS.slice(0, Number(searchParams.get('limit') ?? 50)) });
        return;

      case pathname === '/api/v1/chats' && req.method === 'POST': {
        const chat = { id: `cht_${randomUUID().slice(0, 8)}`, title: 'New chat', updatedAt: Date.now() };
        CHATS.unshift({ ...chat, lastMessage: '', unread: 0 });
        MESSAGES[chat.id] = [];
        json(res, chat, 201);
        return;
      }

      case /^\/api\/v1\/chats\/[\w-]+\/messages$/.test(pathname): {
        const chatId = pathname.split('/')[4] ?? '';
        json(res, { messages: MESSAGES[chatId] ?? [] });
        return;
      }

      case pathname === '/api/v1/chat' && req.method === 'POST': {
        let parsed = { chatId: '', content: '' };
        try {
          parsed = JSON.parse(await readBody(req));
        } catch {
          /* ignore */
        }
        const chatId = parsed.chatId ?? '';
        const content = String(parsed.content ?? '');
        const list = MESSAGES[chatId] ?? (MESSAGES[chatId] = []);
        list.push({ id: `m_${randomUUID()}`, chatId, role: 'user', content, createdAt: Date.now() });
        streamReply(req, res, content);
        // Persist the assistant reply for the next history fetch.
        const reply =
          'Here’s what I found. The local model handles this fine, and it keeps the bytes on your machine.\n\nI looked at the three call sites you mentioned. Two are trivial, one needs a decision from you — the admin route still relies on the shim for long-lived sessions.\n\nWant me to prepare the diff? I won’t apply it until you approve.';
        setTimeout(() => {
          list.push({ id: `m_${randomUUID()}`, chatId, role: 'assistant', content: reply, createdAt: Date.now() });
          const chat = CHATS.find((c) => c.id === chatId);
          if (chat) {
            chat.lastMessage = reply.slice(0, 120);
            chat.updatedAt = Date.now();
          }
        }, 900);
        return;
      }

      case pathname === '/api/v1/approvals' && req.method === 'GET': {
        const status = searchParams.get('status') ?? 'pending';
        const approvals = status === 'all' ? APPROVALS : APPROVALS.filter((a) => a.status === status);
        json(res, { approvals });
        return;
      }

      case /^\/api\/v1\/approvals\/[\w-]+$/.test(pathname) && req.method === 'GET': {
        const id = pathname.split('/')[4] ?? '';
        const approval = APPROVALS.find((a) => a.id === id);
        if (!approval) {
          json(res, { error: 'Not found' }, 404);
          return;
        }
        json(res, approval);
        return;
      }

      case /^\/api\/v1\/approvals\/[\w-]+$/.test(pathname) && req.method === 'POST': {
        const id = pathname.split('/')[4] ?? '';
        const approval = APPROVALS.find((a) => a.id === id);
        if (!approval) {
          json(res, { error: 'Not found' }, 404);
          return;
        }
        let parsed = { decision: 'approve' };
        try {
          parsed = JSON.parse(await readBody(req));
        } catch {
          /* default */
        }
        approval.status = parsed.decision === 'deny' ? 'denied' : 'approved';
        approval.resolvedAt = Date.now();
        json(res, { ok: true, status: approval.status });
        return;
      }

      case pathname === '/api/v1/voice/transcribe' && req.method === 'POST': {
        // Stand-in for src/voice/stt.ts — echoes a plausible transcript.
        const samples = [
          'Remind me to review the deploy checklist before the release.',
          'How much did we spend on embeddings today?',
          'Approve the auth middleware change if the tests pass.',
        ];
        json(res, { transcript: samples[Math.floor(Math.random() * samples.length)] ?? samples[0] });
        return;
      }

      /* desktop-only conveniences for the demo ----------------------------- */
      case pathname === '/api/demo/approvals' && req.method === 'POST': {
        const approval = {
          id: `apr_${randomUUID().slice(0, 4)}`,
          title: 'Deploy xr-api to staging',
          summary: 'Triggered from the desktop demo panel.',
          workspace: 'xr-infra',
          createdAt: Date.now(),
          status: 'pending',
          budgetCents: 45,
          language: 'bash',
          diff: 'diff --git a/deploy.sh b/deploy.sh\nindex 111..222 100644\n--- a/deploy.sh\n+++ b/deploy.sh\n@@ -1,4 +1,4 @@\n-echo "deploying to prod"\n+echo "deploying to staging"\n kubectl apply -f k8s/staging/',
        };
        APPROVALS.unshift(approval);
        // Fan out a push to every paired phone.
        const results = await Promise.all(
          (await devicesWithPush()).map((device) =>
            sendPush(
              device,
              { title: 'XR approval needed', body: `Deploy xr-api to staging`, approvalId: approval.id, ts: Date.now() },
              DEFAULT_TTL_SECONDS,
            ),
          ),
        );
        json(res, { ok: true, approval, pushed: results.length });
        return;
      }

      default:
        json(res, { error: 'Not found' }, 404);
    }
  },
);

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

/* -------------------------------------------------------------------- start --- */

server.listen(PORT, HOST, async () => {
  const cyan = '\x1b[36m';
  const dim = '\x1b[2m';
  const reset = '\x1b[0m';
  const bold = '\x1b[1m';

  console.log(`\n${bold}XR daemon ${VERSION}${reset}  ${dim}(reference daemon — Phase 28 harness)${reset}\n`);

  if (LAN && cert) {
    console.log(`${cyan}⚠️  LAN mode: XR is reachable on your WiFi network at ${LOCAL_URL}.${reset}`);
    console.log(`${cyan}    Only devices on the same network AND with the pairing code can connect.${reset}`);
    console.log(`${cyan}    Run without --lan to disable.${reset}\n`);
    console.log(`   Certificate fingerprint`);
    console.log(`   ${bold}${cert.fingerprintPretty}${reset}`);
    console.log(`   ${dim}(compare this on your phone before pairing)${reset}\n`);
    console.log(`   LAN addresses   ${lanAddresses().join(', ')}`);
    console.log(`   Devices paired  ${(await listDevices()).length}`);
    console.log(`   ${dim}Pair a phone: POST /api/mobile/pair-qr (desktop) → scan the QR${reset}\n`);
  } else {
    console.log(`   Listening on ${dim}http://127.0.0.1:${PORT}${reset} (loopback only)`);
    console.log(`   ${dim}LAN mode is off. Start with --lan to pair a phone.${reset}\n`);
  }

  console.log(`   Daemon token    ${DAEMON_TOKEN}`);
  console.log(`   Mobile app      ${LOCAL_URL}/mobile/\n`);
});
