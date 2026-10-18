/**
 * Paired-device registry (~/.xr/devices.json). Rules: session tokens are
 * stored HASHED (a stolen devices.json cannot be replayed); every entry
 * carries `kind` (mobile/desktop) which gates dangerous endpoints (see
 * mobile-pairing.ts); revoking rotates the token server-side and invalidates
 * the phone's cookie on its next request; `pushKey` is the device-generated
 * AES-GCM key for the second push-encryption layer.
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
  tokenHash: string;   // SHA-256 of the session token — never the token itself
  pairedAt: number;
  lastSeenAt: number;
  fingerprint?: string | undefined;         // cert fingerprint pinned at pairing (hex)
  pushSubscription?: WireSubscription | undefined;
  pushKey?: string | undefined;             // base64 AES-GCM key (2nd push-encryption layer)
  revokedAt?: number | undefined;
}

export interface DeviceRegistry {
  version: 1;
  devices: PairedDevice[];
}

// Phase 2.4 · P1-1 — lazy HOME resolution (Phase 24 convention).
const REGISTRY_PATH = () => join(homedir(), '.xr', 'devices.json');

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a), bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

let cache: DeviceRegistry | null = null;

export async function loadRegistry(): Promise<DeviceRegistry> {
  if (cache) return cache;
  try {
    const raw = await readFile(REGISTRY_PATH(), 'utf8');
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
  await writeFile(REGISTRY_PATH(), `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
}

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
    id: randomBytes(9).toString('base64url'), name: args.name.slice(0, 48) || 'XR device',
    kind: args.kind, tokenHash: hashToken(token), pairedAt: now, lastSeenAt: now,
    ...(args.fingerprint ? { fingerprint: args.fingerprint } : {}),
    ...(args.pushKey ? { pushKey: args.pushKey } : {}),
    ...(args.pushSubscription ? { pushSubscription: args.pushSubscription } : {}),
  };
  registry.devices.push(device);
  await saveRegistry(registry);
  return { device, token };
}

export async function findByToken(token: string): Promise<PairedDevice | null> {
  const wanted = hashToken(token);
  for (const device of (await loadRegistry()).devices) {
    if (!device.revokedAt && safeEqual(device.tokenHash, wanted)) return device;
  }
  return null;
}

export async function findById(id: string): Promise<PairedDevice | null> {
  const registry = await loadRegistry();
  return registry.devices.find((device) => device.id === id) ?? null;
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
  return (await listDevices()).filter((d) => d.kind === 'mobile' && d.pushSubscription && d.pushKey);
}
