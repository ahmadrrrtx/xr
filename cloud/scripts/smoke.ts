#!/usr/bin/env bun
/**
 * Boot smoke test — the fastest way to answer "does this deployment work".
 *
 * Boots the real composition root against a scratch PGlite database, applies
 * migrations, and exercises the endpoints whose failure would be invisible until
 * a customer hit them: health, readiness, the licence public key document, and
 * the unauthenticated shape of a protected route.
 *
 * Run: `bun run smoke`
 */
import { createApp } from "../src/app.ts";
import { resetEnvCache, loadEnv } from "../src/env.ts";
import { bootstrap } from "../src/bootstrap.ts";

const scratch = `.xr-cloud-smoke-${Date.now()}`;

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_DRIVER: "pglite",
  PGLITE_DIR: scratch,
  JWT_SECRET: "smoke-test-secret-that-is-long-enough-to-pass-validation",
  XR_KEY_ENCRYPTION_KEY: "7DoG1/LYXQB8WIKmOBJt7J2YuZLKrLuckzW+79FYJIY=",
  APP_URL: "http://localhost:3000",
  API_URL: "http://localhost:8787",
  LOG_LEVEL: "error",
  MAIL_TRANSPORT: "capture",
  MAIL_CAPTURE_DIR: `${scratch}-mail`,
});
resetEnvCache();

const { deps, shutdown } = await bootstrap(loadEnv(process.env, { reload: true }));
const { hono } = createApp(deps);

const results: Array<{ name: string; ok: boolean; detail: string }> = [];

async function check(name: string, fn: () => Promise<{ ok: boolean; detail: string }>) {
  try {
    const r = await fn();
    results.push({ name, ...r });
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

await check("GET /healthz", async () => {
  const res = await hono.request("/healthz");
  const body = (await res.json()) as { ok?: boolean; service?: string };
  return { ok: res.status === 200 && body.ok === true, detail: `${res.status} ${body.service ?? ""}` };
});

await check("GET /readyz", async () => {
  const res = await hono.request("/readyz");
  const body = (await res.json()) as { ok?: boolean; checks?: Record<string, unknown> };
  const caps = Object.keys(body.checks ?? {}).join(", ");
  return { ok: res.status === 200 && body.ok === true, detail: `${res.status} checks: ${caps}` };
});

await check("GET /.well-known/security.txt", async () => {
  const res = await hono.request("/.well-known/security.txt");
  const text = await res.text();
  return { ok: res.status === 200 && text.includes("Contact:"), detail: `${res.status}` };
});

await check("GET /.well-known/xr-license-pubkey", async () => {
  const res = await hono.request("/.well-known/xr-license-pubkey");
  const body = (await res.json()) as { keys?: unknown[]; usage?: string };
  // With no signing key configured this is a legitimately empty key set — and the
  // response must say so rather than 404, so a client can distinguish "not
  // configured" from "wrong URL".
  return {
    ok: res.status === 200 && Array.isArray(body.keys),
    detail: `${res.status} keys=${body.keys?.length ?? 0}`,
  };
});

await check("GET /auth/me without credentials → 401", async () => {
  const res = await hono.request("/auth/me");
  const body = (await res.json()) as { error?: { code?: string; repair?: string } };
  return {
    ok: res.status === 401 && body.error?.code === "unauthorized" && Boolean(body.error?.repair),
    detail: `${res.status} ${body.error?.code ?? ""} repair=${body.error?.repair ? "yes" : "no"}`,
  };
});

await check("POST /auth/signup creates org + trial", async () => {
  const res = await hono.request("/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: `smoke-${Date.now()}@example.com`,
      name: "Smoke",
      orgName: "Smoke Team",
    }),
  });
  const body = (await res.json()) as { org?: { id?: string }; plan?: string; tokens?: { accessToken?: string } };
  return {
    ok: res.status === 201 && Boolean(body.org?.id) && body.plan === "trial" && Boolean(body.tokens?.accessToken),
    detail: `${res.status} plan=${body.plan ?? "-"}`,
  };
});

await check("unknown route → JSON 404", async () => {
  const res = await hono.request("/nope");
  const body = (await res.json()) as { error?: { code?: string } };
  return { ok: res.status === 404 && body.error?.code === "not_found", detail: `${res.status}` };
});

await shutdown();

let failures = 0;
process.stdout.write("\nXR Cloud — boot smoke\n─────────────────────\n");
for (const r of results) {
  if (!r.ok) failures += 1;
  process.stdout.write(`${r.ok ? "  ok  " : " FAIL "} ${r.name.padEnd(46)} ${r.detail}\n`);
}
process.stdout.write(`\n${results.length - failures}/${results.length} passed\n`);

await Bun.$`rm -rf ${scratch} ${scratch}-mail`.quiet().nothrow();
process.exit(failures === 0 ? 0 : 1);
