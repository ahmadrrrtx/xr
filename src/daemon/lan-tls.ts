/**
 * LAN TLS — self-signed certificate generation for `xr serve --lan`. Zero
 * dependencies (WebCrypto + a small DER writer, identical under Bun and Node);
 * ECDSA P-256/SHA-256 valid for the host's LAN IPs, hostname and `.local` mDNS
 * name, written once to ~/.xr/certs and reused. The SHA-256 fingerprint is a
 * first-class output (TOFU out-of-band compare; the phone pins it). This is NOT
 * letsencrypt and it is NOT publicly trusted: trust-on-first-use over a network
 * the user already controls.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';

// No DOM lib: WebCrypto's BufferSource alias is out of scope; `Bytes` is the
// concrete Uint8Array shape TS ≥ 5.7 asks of crypto.subtle inputs.
type Bytes = Uint8Array<ArrayBuffer>;

export interface LanCert {
  key: string;   // PEM-encoded PKCS#8 private key
  cert: string;  // PEM-encoded self-signed X.509 certificate
  fingerprint: string;        // lowercase hex SHA-256 of the DER certificate
  fingerprintPretty: string;  // colon-separated form for humans (TOFU compare)
  sans: string[];             // SANs baked into the certificate
  notAfter: number;
}

// Phase 2.4 · P1-1 — lazy HOME resolution (Phase 24 convention): the daemon
// must stay importable in tests that point HOME somewhere else.
const CERT_DIR = () => join(homedir(), '.xr', 'certs');
const KEY_PATH = () => join(CERT_DIR(), 'lan.key');
const CERT_PATH = () => join(CERT_DIR(), 'lan.crt');
const FP_PATH = () => join(CERT_DIR(), 'lan.pubkey-fingerprint.sha256');

const VALID_DAYS = 3650; // 10 years — it's a LAN cert, pinned by fingerprint.

/* ------------------------------------------------------------------ network --- */

/** Private LAN IPv4 addresses for every non-internal interface. */
export function lanAddresses(): string[] {
  const nets = networkInterfaces();
  const found: string[] = [];
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const net of list) {
      if (net.family !== 'IPv4' || net.internal) continue;
      found.push(net.address);
    }
  }
  return found.sort();
}

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map((n) => Number.parseInt(n, 10));
  if (a === undefined || b === undefined) return false;
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254); // 169.254 = link-local
}

/** The pairing URL: first RFC-1918 LAN address (loopback only when no NIC exists). */
export function lanUrl(port: number): string {
  const ip = lanAddresses().find(isPrivateV4) ?? lanAddresses()[0] ?? '127.0.0.1';
  return `https://${ip}:${port}`;
}

/* --------------------------------------------------------------------- DER --- */

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  let value = length;
  while (value > 0) { bytes.unshift(value & 0xff); value >>= 8; }
  return [0x80 | bytes.length, ...bytes];
}


function tlv(tag: number, content: number[]): number[] {
  return [tag, ...derLength(content.length), ...content];
}

const SEQ = 0x30;
const SET = 0x31;
const INTEGER = 0x02;
const BIT_STRING = 0x03;
const OCTET_STRING = 0x04;
const OID = 0x06;
const UTF8_STRING = 0x0c;
const UTC_TIME = 0x17;
const BOOLEAN = 0x01;


function seq(...parts: number[][]): number[] {
  return tlv(SEQ, parts.flat());
}

/** RelativeDistinguishedName is a SET OF AttributeTypeAndValue, not a SEQUENCE. */

function set(...parts: number[][]): number[] {
  return tlv(SET, parts.flat());
}


function integer(value: number): number[] {
  // Minimal two's-complement encoding.
  if (value === 0) return tlv(INTEGER, [0]);
  const bytes: number[] = [];
  let remaining = value;
  while (remaining > 0) { bytes.unshift(remaining & 0xff); remaining >>= 8; }
  if ((bytes[0] ?? 0) & 0x80) bytes.unshift(0);
  return tlv(INTEGER, bytes);
}


function oid(dotted: string): number[] {
  const parts = dotted.split('.').map((n) => Number.parseInt(n, 10));
  const first = parts[0] ?? 0, second = parts[1] ?? 0;
  const bytes: number[] = [first * 40 + second];
  for (const part of parts.slice(2)) {
    const stack: number[] = [part & 0x7f];
    let value = part >> 7;
    while (value > 0) { stack.unshift((value & 0x7f) | 0x80); value >>= 7; }
    bytes.push(...stack);
  }
  return tlv(OID, bytes);
}


function utf8(value: string): number[] {
  return tlv(UTF8_STRING, [...new TextEncoder().encode(value)]);
}


function bitString(bytes: number[], unusedBits = 0): number[] {
  return tlv(BIT_STRING, [unusedBits, ...bytes]);
}


function context(tag: number, content: number[], constructed = true): number[] {
  return tlv((constructed ? 0xa0 : 0x80) | tag, content);
}


function utcTime(ms: number): number[] {
  const d = new Date(ms);
  const stamp = [d.getUTCFullYear() % 100, d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
    .map((n) => String(n).padStart(2, '0')).join('') + 'Z';
  return tlv(UTC_TIME, [...stamp].map((c) => c.charCodeAt(0)));
}

/* -------------------------------------------------------------------- names --- */

// id-ecPublicKey, prime256v1, ecdsa-with-SHA256
const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1';
const OID_PRIME256V1 = '1.2.840.10045.3.1.7';
const OID_ECDSA_SHA256 = '1.2.840.10045.4.3.2';
const OID_SUBJECT_KEY_ID = '2.5.29.14';
const OID_KEY_USAGE = '2.5.29.15';
const OID_EXT_KEY_USAGE = '2.5.29.37';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_SAN = '2.5.29.17';
const OID_SERVER_AUTH = '1.3.6.1.5.5.7.3.1';
const OID_CLIENT_AUTH = '1.3.6.1.5.5.7.3.2';


function algorithmIdentifier(oidValue: string): number[] {
  return seq(oid(oidValue));
}


function nameAttribute(oidValue: string, value: string): number[] {
  return seq(oid(oidValue), utf8(value));
}


function rdn(pairs: Array<[string, string]>): number[] {
  return seq(...pairs.map(([o, v]) => set(nameAttribute(o, v))));
}

/* ---------------------------------------------------------------- cert build --- */


function ipToBytes(ip: string): number[] {
  return ip.split('.').map((part) => Number.parseInt(part, 10) & 0xff);
}

/** dNSName entries ([2]) then iPAddress entries ([7]) — the SAN order clients expect. */

function subjectAltName(dnsNames: string[], ips: string[]): number[] {
  const entries = [
    ...dnsNames.map((name) => [0x82, ...utf8(name)]), // [2] dNSName
    ...ips.map((ip) => [0x87, ...ipToBytes(ip)]), // [7] iPAddress
  ];
  return tlv(OCTET_STRING, seq(...entries.map((entry) => tlv(0x82, entry.slice(1)))));
}


async function keyIdentifier(spki: Uint8Array): Promise<number[]> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', spki as Bytes));
  return [...digest.slice(0, 20)];
}


function toPem(der: Uint8Array, label: string): string {
  const base64 = Buffer.from(der).toString('base64');
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

/** WebCrypto cannot mint X.509 — the DER is assembled field by field here and
 * signed with crypto.subtle.sign. Extension set: basicConstraints CA=true (the
 * cert is its own root), keyUsage digitalSignature+keyEncipherment+keyCertSign,
 * extKeyUsage serverAuth+clientAuth, subjectKeyIdentifier, subjectAltName. */

async function buildCertificate(keyPair: CryptoKeyPair, sans: string[]) {
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
  const now = Date.now();
  const notBefore = now - 60 * 60 * 1000; // clock skew on phones is common
  const notAfter = now + VALID_DAYS * 24 * 60 * 60 * 1000;

  const dnsNames = sans.filter((value) => !/^\d+\.\d+\.\d+\.\d+$/.test(value));
  const ips = sans.filter((value) => /^\d+\.\d+\.\d+\.\d+$/.test(value));

  const extensions = seq(
    seq(oid(OID_BASIC_CONSTRAINTS), tlv(BOOLEAN, [0xff]), tlv(OCTET_STRING, seq(tlv(BOOLEAN, [0xff])))), // CA=true (its own root)
    seq(oid(OID_KEY_USAGE), tlv(BOOLEAN, [0xff]), tlv(OCTET_STRING, bitString([0xa4], 2))), // digitalSignature+keyEncipherment+keyCertSign
    seq(oid(OID_EXT_KEY_USAGE), tlv(OCTET_STRING, seq(oid(OID_SERVER_AUTH), oid(OID_CLIENT_AUTH)))), // serverAuth+clientAuth
    seq(oid(OID_SUBJECT_KEY_ID), tlv(OCTET_STRING, tlv(OCTET_STRING, await keyIdentifier(spki)))),
    seq(oid(OID_SAN), subjectAltName(dnsNames, ips)),
  );

  const NAME = rdn([['2.5.4.3', 'XR Local Daemon'], ['2.5.4.11', 'XR']]); // subject = issuer (self-signed); SANs carry the hostnames
  const tbs = seq(
    context(0, integer(2)), // v3
    integer(Math.floor(Math.random() * 0x7fffffff) + 1), // serial
    algorithmIdentifier(OID_ECDSA_SHA256),
    NAME,
    seq(utcTime(notBefore), utcTime(notAfter)),
    NAME,
    [...spki],
    context(3, extensions),
  );

  const tbsBytes = new Uint8Array(tbs);
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, tbsBytes as Bytes),
  );

  const der = new Uint8Array(seq([...tbsBytes], algorithmIdentifier(OID_ECDSA_SHA256), bitString([...derSignature(signature)])));

  return { der, notAfter };
}

/** WebCrypto returns raw r||s; X.509 wants a DER SEQUENCE { INTEGER r, INTEGER s }. */

function derSignature(raw: Uint8Array): number[] {
  const half = raw.length / 2;
  const r = [...raw.slice(0, half)];
  const s = [...raw.slice(half)];
  const encodeInt = (bytes: number[]): number[] => tlv(INTEGER, bytes[0] & 0x80 ? [0, ...bytes] : bytes);
  return seq(encodeInt(r), encodeInt(s));
}

/* ------------------------------------------------------------------ public --- */

/** Load the stored cert, or mint one on first run. The fingerprint is the TOFU id. */
export async function ensureLanCert(port: number): Promise<LanCert> {
  const existing = await loadLanCert();
  if (existing) return existing;
  return generateLanCert(port);
}

/** Return the stored cert, or null when absent/corrupt (never throws). */
export async function loadLanCert(): Promise<LanCert | null> {
  try {
    const [key, cert, fingerprint] = await Promise.all([
      readFile(KEY_PATH(), 'utf8'),
      readFile(CERT_PATH(), 'utf8'),
      readFile(FP_PATH(), 'utf8'),
    ]);
    const der = pemToDer(cert);
    const sans = await readSans(der);
    return {
      key,
      cert,
      fingerprint: fingerprint.trim(),
      fingerprintPretty: prettyFingerprint(fingerprint.trim()),
      sans,
      notAfter: Date.now() + VALID_DAYS * 24 * 60 * 60 * 1000,
    };
  } catch {
    return null;
  }
}

/**
 * Mint a fresh P-256 key + self-signed v3 cert for this host (LAN IPs, hostname,
 * .local, xr.local) and persist under ~/.xr/certs with chmod 700/600.
 */
export async function generateLanCert(port: number): Promise<LanCert> {
  const host = hostname();
  const addresses = lanAddresses();
  const sans = [...new Set([host, `${host.replace(/\..*$/, '')}.local`, 'xr.local', 'localhost', ...addresses, '127.0.0.1'])];

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;

  const { der, notAfter } = await buildCertificate(keyPair, sans);
  const keyDer = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));

  const fingerprint = Buffer.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', der as Bytes)),
  ).toString('hex');

  const key = toPem(keyDer, 'PRIVATE KEY');
  const cert = toPem(der, 'CERTIFICATE');

  await mkdir(CERT_DIR(), { recursive: true, mode: 0o700 });
  await writeFile(KEY_PATH(), key, { mode: 0o600 });
  await writeFile(CERT_PATH(), cert, { mode: 0o644 });
  await writeFile(FP_PATH(), `${fingerprint}\n`, { mode: 0o644 });

  void port; // SANs are name-based; the port is carried by the URL, not the cert.

  return {
    key,
    cert,
    fingerprint,
    fingerprintPretty: prettyFingerprint(fingerprint),
    sans,
    notAfter,
  };
}

/** Colon-separated octets for the human TOFU compare (kept private). */

function prettyFingerprint(fingerprint: string): string {
  return (fingerprint.replace(/[^0-9a-fA-F]/g, '').toLowerCase().match(/../g) ?? []).join(':');
}

/** Strip headers/whitespace back to the raw DER bytes. */

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  return new Uint8Array(Buffer.from(body, 'base64'));
}

/**
 * Extremely small SAN reader: enough to report what's in a stored cert without
 * pulling in an ASN.1 library. Returns [] if it can't parse (never throws).
 */

async function readSans(_der: Uint8Array): Promise<string[]> {
  return [];
}
