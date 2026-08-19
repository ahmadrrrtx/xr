# Research — Citations & provenance

## Model

```ts
interface ResearchCitation {
  id: string;          // c1..cN
  sourceId: string;    // s1..sN — always maps to a retrieved source
  url: string;
  title?: string;
  publishedAt?: string;  // only when the source reports it
  retrievedAt: number;   // XR's clock
  locator?: string;      // optional within-source location
  excerpt?: string;
  contentHash?: string;  // sha256 of retrieved content
}
```

## Rules (never fabricate)

- A citation exists **only** for a source XR actually retrieved
  (`verification ∈ {retrieved, consistent, conflicting, stale}`). Discovered-
  but-unfetched search hits are not citable.
- Metadata is only what was observed: unknown fields stay undefined.
- `retrievedAt` is always XR's clock; `publishedAt` only when reported.

## Verification states

`unverified → retrieved → consistent | conflicting | stale | failed`

- `conflicting` is set from explicit cross-source disagreement (the existing
  synthesizer's contradiction detection), not inferred.
- `stale` is set when a re-check changed the content hash.
- The runner does not pretend to know "official" automatically.

## Provenance chain

```
query → plan/request → provider → request → source → page → finding → citation → job
```

Persisted on the job (`ResearchJob.request.source`, `provider`, timestamps) and
audited through the existing hash-chained audit log (`research.start`,
`research.search`, `research.fetch`, `research.ssrf_blocked`,
`research.injection_detected`, …).

## "Where did this claim come from?"

A report can always answer this: every `[sN]` reference resolves to a
`ResearchSource` (url + domain + verification + content hash), and every
retrieved source has a `ResearchCitation`.
