/**
 * XR Phase 30 — team memory bridge.
 *
 * Three invariants, in order of how much damage breaking them would do:
 *
 *  1. **Nothing sensitive leaves the machine.** The scanner runs before the
 *     request is made, and a blocked fact must produce *zero* calls. Asserting
 *     only on the returned error would pass against an implementation that sent
 *     the fact and then apologised.
 *  2. **A block is recoverable by a human and not by an agent.** The
 *     acknowledgement path exists and is explicit; the agent-suggested path never
 *     sets it.
 *  3. **Recall only sees facts the team can actually see.** A fact awaiting review
 *     or marked private is excluded on the read path as well as on the server.
 */

import { describe, expect, test } from "bun:test";
import { createTeamMemory, toRecallEntries, type TeamFact, type TeamResult } from "../../src/context/memory/team.ts";

interface Call {
  path: string;
  method: string;
  body: unknown;
}

/** A capture-mode transport: records every call and never touches a network. */
function transport(response: TeamResult<unknown> = { ok: true, value: {} }) {
  const calls: Call[] = [];
  return {
    calls,
    call: async <T>(path: string, init?: { method?: string; body?: unknown }): Promise<TeamResult<T>> => {
      calls.push({ path, method: init?.method ?? "GET", body: init?.body });
      return response as TeamResult<T>;
    },
  };
}

const fact = (over: Partial<TeamFact> = {}): TeamFact => ({
  id: "mem_1",
  workspaceId: "wsp_1",
  category: "fact",
  body: "Deploys happen on Thursdays.",
  visibility: "team",
  version: 1,
  tags: [],
  updatedAt: "2026-10-14T00:00:00.000Z",
  ...over,
});

describe("the sensitivity scanner runs before upload", () => {
  test("an API key is refused with zero requests made", async () => {
    const t = transport();
    const memory = createTeamMemory({ call: t.call });

    const result = await memory.promote({
      workspaceId: "wsp_1",
      category: "fact",
      body: "The staging key is sk-ant-api03-QWERTYUIOPASDFGHJKLZXCVBNM1234567890abcdef",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toContain("not sent anywhere");
    // The assertion that matters: the request was never attempted.
    expect(t.calls).toHaveLength(0);
    // And the match is reported by kind, never by echoing the value.
    expect(result.blocked?.[0]?.kind).toBe("api-key");
    expect(JSON.stringify(result.blocked)).not.toContain("sk-ant-api03");
  });

  test("a private key block reports the kind without the body", async () => {
    const t = transport();
    const memory = createTeamMemory({ call: t.call });
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";

    const result = await memory.promote({ workspaceId: "wsp_1", category: "fact", body: pem });
    expect(result.ok).toBe(false);
    expect(t.calls).toHaveLength(0);
    if (!result.ok) expect(result.blocked?.map((m) => m.kind)).toContain("private-key");
  });

  test("a clean fact is sent, and carries the scanner's verdict", async () => {
    const t = transport({ ok: true, value: { fact: fact(), pendingReview: false } });
    const memory = createTeamMemory({ call: t.call });

    const result = await memory.promote({
      workspaceId: "wsp_1",
      category: "fact",
      body: "Deploys happen on Thursdays, after the freeze lifts.",
      tags: ["process"],
    });

    expect(result.ok).toBe(true);
    expect(t.calls).toHaveLength(1);
    const body = t.calls[0]!.body as Record<string, unknown>;
    expect(body.workspaceId).toBe("wsp_1");
    expect(body.provenance).toBe("human");
    // `direct` is the daemon's mapping of provenance (false ⇒ the review queue);
    // the bridge classifies and sends the provenance itself.
    expect(body.direct).toBeUndefined();
    expect(body.sensitivityTags).toEqual([]);
  });

  test("a human acknowledgement sends the fact and says so", async () => {
    const t = transport({ ok: true, value: { fact: fact(), pendingReview: false } });
    const memory = createTeamMemory({ call: t.call });

    // A Luhn-valid test number, which is exactly what the card detector looks
    // for — the acknowledgement path exists for this case, not for real cards.
    const result = await memory.promote({
      workspaceId: "wsp_1",
      category: "fact",
      body: "The Stripe test fixture is 4242424242424242 and it is not a real card.",
      acknowledgeSensitive: true,
    });

    expect(result.ok).toBe(true);
    expect(t.calls).toHaveLength(1);
    const body = t.calls[0]!.body as Record<string, unknown>;
    expect(body.acknowledgeSensitive).toBe(true);
    // The server records that a person accepted a flagged fact, rather than
    // receiving something that looks clean after the fact.
    expect(body.sensitivityTags).toEqual(["credit-card"]);
  });
});

describe("agents propose; people promote", () => {
  test("an agent-suggested fact is sent as a proposal, not a direct write", async () => {
    const t = transport({ ok: true, value: { fact: fact({ visibility: "review" }), pendingReview: true } });
    const memory = createTeamMemory({ call: t.call });

    const result = await memory.promote({
      workspaceId: "wsp_1",
      category: "fact",
      body: "The team convention is squash-merge.",
      provenance: "agent-suggested",
    });

    expect(result.ok).toBe(true);
    const body = t.calls[0]!.body as Record<string, unknown>;
    // The provenance is what the daemon turns into `direct: false` — the review
    // queue. Asserted on both sides of the boundary (here and in
    // test/cloud/routes.test.ts) because this is the rule that keeps an agent
    // from writing to a shared workspace on its own.
    expect(body.provenance).toBe("agent-suggested");
    if (result.ok) expect(result.value.pendingReview).toBe(true);
  });
});

describe("availability is answered locally and never throws", () => {
  test("a free organization gets a reason and the promise", async () => {
    const t = transport({ ok: true, value: { available: false, reason: "Needs the Business tier." } });
    const memory = createTeamMemory({ call: t.call });
    const availability = await memory.availability();
    expect(availability.available).toBe(false);
    expect(availability.reason).toBeString();
    expect(availability.localUnaffected).toBe(true);
  });

  test("an unreachable service is a state, not an exception", async () => {
    const t = transport({ ok: false, reason: "Could not reach the XR service.", repair: "Retry when online." });
    const memory = createTeamMemory({ call: t.call });
    const availability = await memory.availability();
    expect(availability.available).toBe(false);
    expect(availability.localUnaffected).toBe(true);
  });
});

describe("recall only sees what the team can see", () => {
  test("review and private facts are excluded from recall", () => {
    const entries = toRecallEntries([
      fact({ id: "a", visibility: "team" }),
      fact({ id: "b", visibility: "review" }),
      fact({ id: "c", visibility: "private" }),
    ]);
    expect(entries.map((e) => e.id)).toEqual(["a"]);
    // Read-only by construction: the flag is not a parameter a caller can flip.
    expect(entries[0]!.readOnly).toBe(true);
    expect(entries[0]!.content).toBe("Deploys happen on Thursdays.");
  });
});
