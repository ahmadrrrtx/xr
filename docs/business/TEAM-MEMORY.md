# TEAM MEMORY

Shared facts between the people in an organization — the feature people most
reasonably assume is a privacy problem, and therefore the one that has to explain
itself most carefully.

- Implementation: `cloud/src/services/memory.ts`, `cloud/src/services/sensitivity.ts`, `cloud/src/routes/memory.ts`.
- Client half: `src/context/memory/team.ts`, `src/cloud/memory-sync.ts`.
- Console page: `/dashboard/memory`.
- Local memory is untouched by all of this. Team memory is a **new scope that sits
  beside** the existing private scopes; it does not move anything out of them.

## 1. The shape of it

A fact has:

| Field | Notes |
| --- | --- |
| `scope` | `team` — the new value. The other scopes (`private`, `workspace`, …) never leave the machine |
| `workspaceId` | Every fact belongs to exactly one team workspace, and is encrypted with a key derived for that workspace alone |
| `category` | Reuses the local memory categories (`MEMORY_CATEGORIES`), so a fact does not change shape by being shared |
| `body` | The text. Stored as ciphertext plus a digest; there is no plaintext column |
| `visibility` | `team` (visible now) or `review` (waiting for a human) |
| `version` | Incremented on every write. Conflicts are visible rather than silent |
| `provenance` | Who wrote it, how (`human` / `agent-suggested` / `import`), and the workspace it came from |

Facts are written by `POST /teams/:id/memory`, read with `GET /teams/:id/memory`,
deleted by `DELETE /teams/:id/memory/:factId`, and exported via
`GET /teams/:id/memory/export`.

## 2. What can leave a machine

Only a fact that someone deliberately puts in a **team workspace**. Concretely:

| Local thing | Does it sync? |
| --- | --- |
| Private memory | **No.** Never, under any setting |
| Session context, transcripts, terminal history, file paths | **No** |
| Local caches, embeddings, RAG index | **No.** Rebuilt locally from synced facts when needed |
| A fact explicitly added to a team workspace | Yes, once |
| An agent-suggested fact | Yes, into the **review queue** — not into the team's memory |

The agent path is the one worth being careful about, which is why a suggestion
lands in `visibility: "review"` and stays there. It is not visible to the team
until a human accepts it, and rejection deletes it rather than hiding it.

## 3. Sensitivity scanning before upload

The Phase 21 scanner (`src/context/memory/sensitivity.ts`) runs **on the client,
before the request is made**, and the same rules run again **on the server**, in
`cloud/src/services/sensitivity.ts`. The server does not trust the client's verdict.

What it looks for, and what happens:

| Kind | Example shapes | Default |
| --- | --- | --- |
| Provider keys | `sk-…`, `sk-ant-…`, `AIza…`, `ghp_…`, `xoxb-…` | Blocked |
| Private keys / certificates | `-----BEGIN … PRIVATE KEY-----` | Blocked |
| Payment cards | 13–19 digits passing the Luhn check | Blocked |
| National identifiers | SSN-shaped, and a small set of non-US equivalents | Blocked |
| Connection strings with credentials | `postgres://user:pass@…` | Blocked |
| High-entropy strings over 32 characters | Look-alike secrets with no known prefix | Blocked when the policy says so |

A blocked fact is refused **at the source**: it is never sent, so it never appears
in the server's logs as a rejected upload either. The error names the kind it
matched (`"looks like a provider API key"`) and never echoes the value.

`policies.blockSensitiveMemory` turns the heuristic half strict; the high-confidence
patterns (private keys, provider key prefixes, Luhn-passing card numbers) are always
blocked and are not configurable, because a toggle there would only ever be used to
do something regrettable.

## 4. Conflicts: last writer wins, visibly

Two people editing the same fact is normal, not exceptional. The rule is
**last-writer-wins with a version id**, and the losing version is not thrown away:

1. A write carries the version the client last saw (`ifVersion`).
2. If it matches, the write lands and `version` increments.
3. If it does not, the write is **still applied** (last writer wins — a shared
   workspace that silently refuses writes is worse), and the previous body is
   recorded in the fact's history with the author and timestamp.
4. The console shows the fact as `v3` with a "changed by someone else" marker, and
   the history is readable.

A local cache of shared facts is **read-only until a conflict resolves**. That is
the only way a cache can be honest: it must not be able to overwrite the shared
copy with a stale one.

## 5. What an administrator can see

This is the question that decides whether people use the feature.

| | |
| --- | --- |
| Read team facts | Yes — that is the feature |
| Read **who** wrote a fact and when | Yes |
| Read the history of a fact | Yes |
| Read private memory of a member | **No.** It does not exist on the server |
| Read prompts or completions | **No.** They are not stored |
| Read an API key, a token, or a client secret | **No** |
| Change a fact | Yes, and the change is audited with the prior body |
| Delete a workspace | Yes — and see §7 for what that means |
| Reach a member's machine | **No mechanism exists** |

Audit entries for memory are written for writes, deletions, review acceptances and
exports: `memory.write`, `memory.delete`, `memory.review.accept`,
`memory.review.reject`, `memory.export`. The entry records the workspace, category
and actor — **not the body**.

## 6. Encryption, and what it does not protect against

```
XR_KEY_ENCRYPTION_KEY (32 bytes, deployment)
        └── wraps ──► org_key (per organization, AES-256-GCM, kek_id recorded)
                          └── HKDF-SHA256("xr:team-memory:v1:<workspaceId>")
                                    └── per-fact AES-256-GCM key
```

- A **database dump alone is not enough** to read facts: the KEK is in the
  environment, not the database.
- An **operator with both** can read them. This is server-side encryption with keys
  we hold, and calling it end-to-end would be a lie. The honest statement is on
  `/security`, in `/dashboard/compliance`, and here.
- Per-message **end-to-end encryption is a v2 design question**. If it ships, it will
  change what administrators can do (§5), which is why it is not being bolted on
  quietly.
- Rotating the KEK re-wraps `org_key` values; the recorded `kek_id` is what makes
  that findable. Facts themselves do not need re-encryption.

## 7. Cancellation, export and deletion

| Moment | Behaviour |
| --- | --- |
| Subscription cancels | Team features stop at the end of the paid period |
| Next 30 days | `GET /teams/:id/memory/export` returns **plaintext JSON of every stored fact** to an owner or admin |
| After 30 days | Facts and the audit log are purged |
| On every member's machine | Local XR is unchanged, permanently. Local caches of shared facts become read-only, then are discarded — never left behind as an orphan that looks like data loss |
| If the service is deleted entirely | Nothing is removed from any machine, because nothing was ever installed on one |

Export is plaintext on purpose. A customer leaving should be able to use what they
had, not receive ciphertext they no longer have a key for.

## 8. Limits and non-goals

- **No per-message E2E** (§6).
- **No fine-grained per-fact ACL.** Visibility is per workspace: everyone in the
  organization who can reach the workspace sees its facts.
- **No full-text search across workspaces.** Search is scoped to one workspace.
- **No real-time collaborative editing.** Conflicts are resolved after the fact (§4).
- **No cross-organization sharing**, in any form. There is no "share a link with
  someone outside the team" and there is not going to be one in v1.0.0.
- **No chat.** Team memory is facts, not messages; per-message encrypted chat is out
  of scope for this release.
