import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { privateMobilePeer } from "../../src/daemon/desktop-mobile-listener.ts";
import { loadDesktopMobileIdentity } from "../../src/daemon/desktop-mobile-cert.ts";

const home = mkdtempSync(join(tmpdir(), "xr-mobile-cert-"));
const dir = join(home, "mobile-tls");
const run = (...args: string[]) => execFileSync("openssl", args, { cwd: home, stdio: "ignore" });
beforeAll(() => {
  mkdirSync(dir);
  run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=XR test CA", "-keyout", "ca.key", "-out", "ca.crt");
  run("req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=phone.xr.test", "-keyout", "mobile-tls/key.pem", "-out", "leaf.csr");
  writeFileSync(join(home, "ext.cnf"), "subjectAltName=DNS:phone.xr.test,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n");
  run("x509", "-req", "-in", "leaf.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-days", "1", "-extfile", "ext.cnf", "-out", "mobile-tls/cert.pem");
  run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=phone.xr.test", "-addext", "subjectAltName=DNS:phone.xr.test", "-keyout", "self.key", "-out", "self.crt");
});
afterAll(() => rmSync(home, { recursive: true, force: true }));
test("accepts a matching CA-issued identity, without claiming phone trust", async () => {
  const id = await loadDesktopMobileIdentity(home, "phone.xr.test");
  expect(id.host).toBe("phone.xr.test");
  expect(id.fingerprint).toMatch(/^[a-f0-9]{64}$/);
});
test("rejects mismatched hostname and invalid hostname before network bind", async () => {
  await expect(loadDesktopMobileIdentity(home, "attacker.xr.test")).rejects.toThrow("does not match");
  await expect(loadDesktopMobileIdentity(home, "https://phone.xr.test")).rejects.toThrow();
  await expect(loadDesktopMobileIdentity(home, "localhost")).rejects.toThrow();
});
test("rejects mismatched keys and self-signed leaf", async () => {
  const cert = join(dir, "cert.pem"), key = join(dir, "key.pem");
  copyFileSync(key, join(home, "leaf.key"));
  copyFileSync(cert, join(home, "leaf.crt"));
  try {
    copyFileSync(join(home, "ca.key"), key);
    await expect(loadDesktopMobileIdentity(home, "phone.xr.test")).rejects.toThrow("do not match");
    copyFileSync(join(home, "self.key"), key); copyFileSync(join(home, "self.crt"), cert);
    await expect(loadDesktopMobileIdentity(home, "phone.xr.test")).rejects.toThrow("Self-signed");
  } finally { copyFileSync(join(home, "leaf.key"), key); copyFileSync(join(home, "leaf.crt"), cert); }
});

test("desktop mobile listener excludes public and malformed peer addresses", () => {
  for (const ip of ["127.0.0.1", "192.168.1.7", "10.4.5.6", "172.16.0.1", "::ffff:192.168.1.2"]) expect(privateMobilePeer(ip)).toBe(true);
  for (const ip of ["8.8.8.8", "172.32.1.1", "192.169.1.1", "::1", "localhost", "", "10.00.1.2"]) expect(privateMobilePeer(ip)).toBe(false);
});

test("generated desktop mobile client forwards the required hostname body", async () => {
  const { XRDaemonClient } = await import("../../src/clients/daemon-client.generated.ts");
  let sent = "";
  const client = new XRDaemonClient({ baseUrl: "http://127.0.0.1", token: "test", fetchImpl: async (_url, init) => {
    sent = String(init?.body ?? ""); return new Response('{"enabled":true}', { status: 200 });
  } });
  await client.mobileDesktopStartPost({ host: "phone.xr.test" });
  expect(JSON.parse(sent)).toEqual({ host: "phone.xr.test" });
});
