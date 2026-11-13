/** Desktop mobile TLS identity. Browser/OS trust remains the authority. */
import { X509Certificate, createPrivateKey } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { isIP } from "node:net";
import { join } from "node:path";
import { createSecureContext } from "node:tls";

const LIMIT = 256 * 1024;
export interface DesktopMobileIdentity { cert: string; key: string; fingerprint: string; host: string; notAfter: number }

/** Fixed XR_HOME paths: the API cannot read arbitrary files on the host. */
async function pemFile(path: string, isKey = false): Promise<string> {
  const info = await lstat(path);
  if (!info.isFile() || info.size < 1 || info.size > LIMIT) throw new Error("TLS identity file is missing or too large");
  if (isKey && process.platform !== "win32" && (info.mode & 0o077) !== 0) throw new Error("TLS private key must be owner-only (chmod 600)");
  return await readFile(path, "utf8");
}

/** No network bind until certificate/key/hostname are structurally valid.
 * This does not and cannot establish that a particular phone trusts the CA. */
export async function loadDesktopMobileIdentity(home: string, inputHost: string): Promise<DesktopMobileIdentity> {
  const host = inputHost.trim().toLowerCase();
  if (host.length > 253 || !host || host === "localhost" || host.endsWith(".localhost") ||
      /[^a-z0-9.:-]/.test(host) || host.includes(":") || host.includes("..")) {
    throw new Error("Enter a valid DNS hostname or IPv4 address for the TLS certificate");
  }
  if (!isIP(host) && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) {
    throw new Error("A fully qualified DNS hostname is required");
  }
  const dir = join(home, "mobile-tls");
  const [cert, key] = await Promise.all([pemFile(join(dir, "cert.pem")), pemFile(join(dir, "key.pem"), true)]);
  const leaf = new X509Certificate(cert);
  const privateKey = createPrivateKey(key);
  const now = Date.now();
  if (!Number.isFinite(Date.parse(leaf.validFrom)) || !Number.isFinite(Date.parse(leaf.validTo)) ||
      now < Date.parse(leaf.validFrom) || now >= Date.parse(leaf.validTo)) throw new Error("TLS certificate is not currently valid");
  if (!leaf.checkPrivateKey(privateKey)) throw new Error("TLS certificate and private key do not match");
  if (!(isIP(host) ? leaf.checkIP(host) : leaf.checkHost(host))) throw new Error("TLS certificate does not match the selected host");
  if (leaf.checkIssued(leaf) && leaf.verify(leaf.publicKey)) throw new Error("Self-signed leaf certificate is not accepted; configure a CA-issued certificate trusted by the phone");
  if (leaf.ca) throw new Error("A CA certificate cannot be used as the server leaf certificate");
  createSecureContext({ cert, key });
  return { cert, key, host, notAfter: Date.parse(leaf.validTo), fingerprint: leaf.fingerprint256.replaceAll(":", "").toLowerCase() };
}
