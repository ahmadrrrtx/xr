/**
 * Paired-device registry (~/.xr/devices.json).
 *
 * Rules:
 *  - Session tokens are stored HASHED. A stolen devices.json cannot be replayed.
 *  - Every entry carries `kind: 'mobile' | 'desktop'`; the daemon uses it to
 *    gate dangerous endpoints (see mobile-pairing.ts).
 *  - Revoking rotates the token server-side, which invalidates the cookie the
 *    phone is holding on its very next request.
 *  - `pushKey` is the device-generated AES-GCM key used to encrypt push
 *    payloads a second time so FCM/APNS see only ciphertext.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export type DeviceKind = 'mobile' | 'desktop';

export interface WireSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PairedDevice {
  id: string;
  name: string;
  kind: DeviceKind;
  /** SHA-256 of the session token — never the token itself. */
  tokenHash: string;
  pairedAt: number;
  lastSeenAt: number;
  /** Cert fingerprint the device pinned at pairing time (hex, no colons). */
  fingerprint?: string | undefined;
  pushSubscription?: WireSubscription | undefined;
  /** Base64 AES-GCM key for the second push-encryption layer. */
  pushKey?: string | undefined;
  revokedAt?: number | undefined;
}

export interface DeviceRegistry {
  version: 1;
  devices: PairedDevice[];
}

const REGISTRY_PATH = join(homedir(), '.xr', 'devices.json');

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/* ------------------------------------------------------------------ storage --- */

let cache: DeviceRegistry | null = null;

export async function loadRegistry(): Promise<DeviceRegistry> {
  if (cache) return cache;
  try {
    const raw = await readFile(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw) as DeviceRegistry;
    cache = parsed.version === 1 ? parsed : { version: 1, devices: [] };
  } catch {
    cache = { version: 1, devices: [] };
  }
  return cache;
}

export async function saveRegistry(registry: DeviceRegistry): Promise<void> {
  cache = registry;
  await mkdir(join(homedir(), '.xr'), { recursive: true, mode: 0o700 });
  await writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
}

/* -------------------------------------------------------------- operations --- */

export async function addDevice(args: {
  name: string;
  kind: DeviceKind;
  fingerprint?: string | undefined;
  pushKey?: string | undefined;
  pushSubscription?: WireSubscription | undefined;
}): Promise<{ device: PairedDevice; token: string }> {
  const registry = await loadRegistry();
  const token = newToken();
  const now = Date.now();
  const device: PairedDevice = {
    id: randomBytes(9).toString('base64url'),
    name: args.name.slice(0, 48) || 'XR device',
    kind: args.kind,
    tokenHash: hashToken(token),
    pairedAt: now,
    lastSeenAt: now,
    ...(args.fingerprint ? { fingerprint: args.fingerprint } : {}),
    ...(args.pushKey ? { pushKey: args.pushKey } : {}),
    ...(args.pushSubscription ? { pushSubscription: args.pushSubscription } : {}),
  };
  registry.devices.push(device);
  await saveRegistry(registry);
  return { device, token };
}

export async function findByToken(token: string): Promise<PairedDevice | null> {
  const registry = await loadRegistry();
  const wanted = hashToken(token);
  for (const device of registry.devices) {
    if (device.revokedAt) continue;
    if (safeEqual(device.tokenHash, wanted)) return device;
  }
  return null;
}

export async function findById(id: string): Promise<PairedDevice | null> {
  const registry = await loadRegistry();
  return registry.devices.find((device) => device.id === id) ?? null;
}

export async function touchDevice(id: string): Promise<void> {
  const registry = await loadRegistry();
  const device = registry.devices.find((entry) => entry.id === id);
  if (!device) return;
  device.lastSeenAt = Date.now();
  // Only hit the disk every minute — this runs on every request.
  if (device.lastSeenAt - (device.pairedAt % 60_000) > 0) cache = registry;
  await saveRegistry(registry);
}

/** Revoke = throw away the token hash, so the presented cookie matches nothing. */
export async function revokeDevice(id: string): Promise<boolean> {
  const registry = await loadRegistry();
  const device = registry.devices.find((entry) => entry.id === id);
  if (!device) return false;
  device.revokedAt = Date.now();
  device.tokenHash = hashToken(newToken()); // unmatchable
  device.pushSubscription = undefined;
  await saveRegistry(registry);
  return true;
}

export async function purgeRevoked(): Promise<number> {
  const registry = await loadRegistry();
  const before = registry.devices.length;
  registry.devices = registry.devices.filter(
    (device) => !device.revokedAt || Date.now() - device.revokedAt < 30 * 24 * 60 * 60 * 1000,
  );
  await saveRegistry(registry);
  return before - registry.devices.length;
}

export async function setPushSubscription(
  id: string,
  subscription: WireSubscription | undefined,
  pushKey?: string,
): Promise<void> {
  const registry = await loadRegistry();
  const device = registry.devices.find((entry) => entry.id === id);
  if (!device) return;
  if (subscription) device.pushSubscription = subscription;
  else device.pushSubscription = undefined;
  if (pushKey) device.pushKey = pushKey;
  await saveRegistry(registry);
}

export async function listDevices(): Promise<PairedDevice[]> {
  const registry = await loadRegistry();
  return registry.devices.filter((device) => !device.revokedAt);
}

export async function devicesWithPush(): Promise<PairedDevice[]> {
  return (await listDevices()).filter(
    (device) => device.kind === 'mobile' && device.pushSubscription && device.pushKey,
  );
}
