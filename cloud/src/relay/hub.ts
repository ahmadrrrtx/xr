/**
 * XR Cloud — relay hub (v1, minimal by design).
 *
 * ## What it is
 *
 * A WebSocket router that lets one of a user's devices reach another over the
 * internet when they are not on the same LAN. The Phase 28 LAN pairing already
 * solved "phone talks to desktop on my own network"; this solves only the case
 * where the network is different.
 *
 * ## What it deliberately is not
 *
 *   - **Not a message queue.** No persistence, no history, no indexing, no
 *     replay. A frame with no connected peer is **dropped** and the sender is
 *     told so. The brief is explicit about this, and it is also the reason this
 *     hub needs no database at all.
 *   - **Not able to read anything.** Frames are `{room, iv, ct}` — an IV and
 *     ciphertext. The key is exchanged at device pairing and never reaches this
 *     service. There is no logging of frame contents because there is nothing
 *     legible to log.
 *   - **Not available on Personal.** Connections require a Business device token
 *     and an org whose policy has `relayEnabled`. A Personal install simply never
 *     connects, which is why the free tier has no relay traffic to explain.
 *
 * ## Backpressure
 *
 * Per-socket queue ceiling. A slow consumer is disconnected with a stated reason
 * rather than being allowed to grow the server's heap (Art. XII · Rule 3 —
 * resources have explicit ceilings).
 */

import type { Logger } from "../lib/logger.ts";

export interface RelayFrame {
  /** Opaque routing key. Derived from the pairing, not from anything readable. */
  room: string;
  /** base64 per-frame IV. */
  iv: string;
  /** base64 ciphertext. This hub cannot decrypt it and does not try. */
  ct: string;
  /** Optional client-side monotonic counter, echoed back for ordering hints. */
  seq?: number;
}

export interface RelayPeer {
  id: string;
  orgId: string;
  userId: string;
  deviceId: string;
  room: string;
  socket: ServerWebSocket<RelaySocketData>;
  connectedAt: number;
  framesSent: number;
  framesDropped: number;
}

export interface RelaySocketData {
  readonly peerId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly room: string;
  queued: number;
}

export interface RelayStats {
  readonly connected: number;
  readonly rooms: number;
  readonly framesRouted: number;
  readonly framesDropped: number;
}

type ServerWebSocket<T> = Bun.ServerWebSocket<T>;

/** Per-socket outbound ceiling. Beyond this the peer is closed, not buffered. */
const MAX_QUEUED_FRAMES = 64;
/** Frames larger than this are refused before they reach a peer. */
export const MAX_FRAME_BYTES = 256 * 1024;

export interface RelayHub {
  /** Mint a peer id before the upgrade, so socket data can carry it. */
  newPeerId(): string;
  /**
   * Attach a live socket. Called from Bun's `websocket.open`, which is the only
   * point at which the socket exists — `server.upgrade()` returns before then.
   */
  attach(input: {
    peerId: string;
    orgId: string;
    userId: string;
    deviceId: string;
    room: string;
    socket: ServerWebSocket<RelaySocketData>;
  }): RelayPeer;
  find(peerId: string): RelayPeer | undefined;
  unregister(peerId: string): void;
  /** Routes to every peer in the room except the sender. Returns how many got it. */
  route(peer: RelayPeer, frame: RelayFrame): number;
  stats(): RelayStats;
  closeAll(reason: string): void;
}

export function createRelayHub(log: Logger): RelayHub {
  const peers = new Map<string, RelayPeer>();
  let framesRouted = 0;
  let framesDropped = 0;
  let counter = 0;

  return {
    newPeerId() {
      counter += 1;
      return `relay_${counter.toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
    },

    find(peerId) {
      return peers.get(peerId);
    },

    attach(input) {
      const peer: RelayPeer = {
        id: input.peerId,
        orgId: input.orgId,
        userId: input.userId,
        deviceId: input.deviceId,
        room: input.room,
        socket: input.socket,
        connectedAt: Date.now(),
        framesSent: 0,
        framesDropped: 0,
      };
      peers.set(peer.id, peer);
      log.info(
        { peerId: peer.id, orgId: peer.orgId, deviceId: peer.deviceId },
        "relay peer connected",
      );
      return peer;
    },

    unregister(peerId) {
      const peer = peers.get(peerId);
      if (!peer) return;
      peers.delete(peerId);
      log.info({ peerId, framesSent: peer.framesSent }, "relay peer disconnected");
    },

    route(peer, frame) {
      let delivered = 0;
      for (const other of peers.values()) {
        if (other.room !== frame.room) continue;
        if (other.id === peer.id) continue;
        if (other.socket.readyState !== 1) continue;

        const data = other.socket.data;
        if (data.queued >= MAX_QUEUED_FRAMES) {
          other.framesDropped += 1;
          framesDropped += 1;
          log.warn({ peerId: other.id }, "relay peer over its queue ceiling — closing");
          other.socket.close(1013, "peer too slow");
          continue;
        }

        const payload = JSON.stringify({
          type: "relay",
          room: frame.room,
          iv: frame.iv,
          ct: frame.ct,
          seq: frame.seq,
          from: peer.deviceId,
        });
        data.queued += 1;
        try {
          other.socket.send(payload);
          other.framesSent += 1;
          delivered += 1;
          framesRouted += 1;
        } catch {
          data.queued = Math.max(0, data.queued - 1);
          other.framesDropped += 1;
          framesDropped += 1;
        }
      }

      if (delivered === 0) {
        // Honest drop, per the brief: "If no device is connected, drops the
        // message." The sender is told, so it can fall back to Web Push instead
        // of believing the frame arrived.
        framesDropped += 1;
        try {
          peer.socket.send(JSON.stringify({ type: "dropped", reason: "no-peer" }));
        } catch {
          // The sender is already gone; nothing to do and nothing to report.
        }
      }
      return delivered;
    },

    stats() {
      const rooms = new Set<string>();
      for (const peer of peers.values()) rooms.add(peer.room);
      return { connected: peers.size, rooms: rooms.size, framesRouted, framesDropped };
    },

    closeAll(reason) {
      for (const peer of peers.values()) {
        try {
          peer.socket.close(1012, reason);
        } catch {
          // Already closing.
        }
      }
      peers.clear();
    },
  };
}

/**
 * Validate a frame without decrypting it. Structural checks only: the hub's whole
 * claim is that it cannot see inside, so it must not try. Size and shape are all
 * it is allowed to have an opinion about.
 */
export function validateFrame(input: unknown): { ok: true; frame: RelayFrame } | { ok: false; reason: string } {
  if (typeof input !== "object" || input === null) return { ok: false, reason: "frame must be an object" };
  const f = input as Record<string, unknown>;
  if (typeof f.room !== "string" || f.room.length < 8 || f.room.length > 128) {
    return { ok: false, reason: "room must be a string of 8–128 characters" };
  }
  if (typeof f.iv !== "string" || f.iv.length < 8 || f.iv.length > 64) {
    return { ok: false, reason: "iv must be a base64 string" };
  }
  if (typeof f.ct !== "string" || f.ct.length === 0) return { ok: false, reason: "ct must be a base64 string" };
  if (f.ct.length > MAX_FRAME_BYTES) return { ok: false, reason: `frame exceeds ${MAX_FRAME_BYTES} bytes` };
  const seq = typeof f.seq === "number" && Number.isFinite(f.seq) ? f.seq : undefined;
  return { ok: true, frame: { room: f.room, iv: f.iv, ct: f.ct, ...(seq !== undefined ? { seq } : {}) } };
}

/**
 * Room id. Derived from the pairing inputs so both devices compute the same value
 * without either telling the server what it is — the server only ever sees the
 * output. SHA-256 of `${orgId}:${pairingSecret}` truncated, and paired with the
 * org so two orgs can never collide into one room.
 */
export function deriveRoomId(orgId: string, pairingSecret: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(`xr:relay-room:v1:${orgId}:${pairingSecret}`);
  return hasher.digest("hex").slice(0, 32);
}
