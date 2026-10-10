import { test } from "node:test";
import assert from "node:assert/strict";
import { createSseParser, parseSseLine } from "../src/daemon/sse";
import { assertLoopbackDaemonUrl, UnsafeDaemonUrlError } from "../src/daemon/url";
import { describeSource, resolveToken } from "../src/daemon/token";

test("sse: payloads survive chunk boundaries; comments and other fields are ignored", () => {
  const p = createSseParser();
  const out: string[] = [];
  out.push(...p.push('data: {"a":'));
  out.push(...p.push('1}\n\n: keepalive\n\nevent: x\ndata: [DONE]\r\n'));
  out.push(...p.end());
  assert.deepEqual(out, ['{"a":1}', "[DONE]"]);
});

test("sse: a trailing line without newline is flushed on end", () => {
  const p = createSseParser();
  assert.deepEqual(p.push('data: {"t":"last"}'), []);
  assert.deepEqual(p.end(), ['{"t":"last"}']);
});

test("sse: parseSseLine handles the optional space after the colon", () => {
  assert.equal(parseSseLine("data:abc"), "abc");
  assert.equal(parseSseLine("data: abc"), "abc");
  assert.equal(parseSseLine(": comment"), null);
  assert.equal(parseSseLine(""), null);
});

test("url: loopback hosts are accepted and normalized to an origin", () => {
  assert.equal(assertLoopbackDaemonUrl("http://127.0.0.1:3141"), "http://127.0.0.1:3141");
  assert.equal(assertLoopbackDaemonUrl("http://localhost:3141/some/path/"), "http://localhost:3141");
  assert.equal(assertLoopbackDaemonUrl("http://[::1]:3141"), "http://[::1]:3141");
});

test("url: anything that is not this machine is refused before a request is made", () => {
  for (const bad of [
    "http://0.0.0.0:3141",
    "http://192.168.1.10:3141",
    "http://example.com",
    "http://127.0.0.1.nip.io:3141",
    "http://10.0.0.5",
    "ftp://127.0.0.1",
    "http://user:pass@127.0.0.1:3141",
    "not a url",
  ]) {
    assert.throws(() => assertLoopbackDaemonUrl(bad), UnsafeDaemonUrlError, `should refuse ${bad}`);
  }
});

test("token: precedence is setting, environment, session, then secret storage", () => {
  const all = { setting: " s ", environment: "e", session: "x", secretStorage: "k" };
  assert.deepEqual(resolveToken(all), { token: "s", source: "setting" });
  assert.deepEqual(resolveToken({ ...all, setting: "  " }), { token: "e", source: "environment" });
  assert.deepEqual(resolveToken({ setting: "", environment: undefined, session: "x", secretStorage: "k" }), {
    token: "x",
    source: "session",
  });
  assert.deepEqual(resolveToken({ secretStorage: "k" }), { token: "k", source: "secret-storage" });
});

test("token: nothing configured resolves to null", () => {
  assert.equal(resolveToken({}), null);
  assert.equal(resolveToken({ setting: "   ", secretStorage: "" }), null);
});

test("token: source descriptions never contain the token", () => {
  for (const source of ["setting", "environment", "session", "secret-storage"] as const) {
    assert.ok(!describeSource(source).includes("abc"));
  }
});
