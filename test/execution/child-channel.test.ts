/**
 * SEC-06 parity contract for the child control channel.
 *
 * The SAME code serves `\\.\pipe\…` on Windows and unix sockets elsewhere;
 * running this suite on any OS exercises the transport that ships on all of
 * them. The child SERVES its own channel (address derived from its pid);
 * the engine pushes with bounded, fail-closed requests.
 *
 *   · a live child acks cancel,
 *   · an unanswered request times out to a DENIAL, never a grant,
 *   · a dead address is a denial, not an exception.
 */
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import {
  controlAddress,
  isWin32,
  sendControl,
  serveControlChannel,
  type ControlMessage,
} from "../../src/util/child-channel.ts";

describe("SEC-06 child control channel", () => {
  test("address shape is per-OS (pipe on win32, socket file elsewhere)", () => {
    const a = controlAddress(4242);
    if (isWin32) expect(a).toBe("\\\\.\\pipe\\xr-ctrl-4242");
    else expect(a).toContain(tmpdir());
  });

  test("cancel reaches a serving child and is acked", async () => {
    const seen: ControlMessage[] = [];
    const child = serveControlChannel((m) => {
      seen.push(m);
      return { ok: true };
    });
    // give the listener a beat to bind
    await new Promise((r) => setTimeout(r, 50));
    const reply = await sendControl(child.address, { type: "cancel", reason: "aborted" }, 1500);
    expect(reply.ok).toBe(true);
    expect(seen.length).toBe(1);
    expect(seen[0].type).toBe("cancel");
    child.close();
  });

  test("approval-decision messages flow with payloads", async () => {
    const child = serveControlChannel((m) => ({ ok: m.type === "approval-decision" && m.approved === false }));
    await new Promise((r) => setTimeout(r, 50));
    const reply = await sendControl(child.address, { type: "approval-decision", id: "a1", approved: false }, 1500);
    expect(reply.ok).toBe(true);
    child.close();
  });

  test("unanswered request fails CLOSED to a denial (timeout)", async () => {
    const child = serveControlChannel(() => new Promise(() => undefined));
    await new Promise((r) => setTimeout(r, 50));
    const reply = await sendControl(child.address, { type: "cancel" }, 250);
    expect(reply.ok).toBe(false);
    expect(reply.reason).toBe("timeout");
    child.close();
  });

  test("dead address is a denial, not an exception", async () => {
    const reply = await sendControl(controlAddress(9), { type: "cancel" }, 400);
    expect(reply.ok).toBe(false);
    expect(typeof reply.reason).toBe("string");
  });
});
