# 07 — Naming & Blockchain Decision (pre-build)
### @ahmadrrrtx · 2026-06-03

---

## PART A — Blockchain / crypto: the verdict

**Decision: DO NOT put blockchain in the core agent. Ship a SHA-256 hash-chained audit log instead. Offer optional Sigstore anchoring as a post-launch, opt-in power feature.**

### Why blockchain would HURT the product
Our entire pitch is **reliability + "never breaks" + $0 + privacy + local-first**. Blockchain fights all of them:
| Our promise | What blockchain does | Conflict |
|---|---|---|
| $0 to operate | gas/fees per on-chain op ("pennies", but "fees accumulate" over many requests) | ❌ breaks $0 |
| Fast / never breaks | "running everything through a blockchain imposes latency and cost" | ❌ slower, more failure modes |
| Privacy / local-first | chains are transparent by default | ❌ wrong property for a personal agent |
| Fixes real threats | agent risks = stolen keys, prompt injection, malicious contracts, overspend | ❌ blockchain solves none of these |

Expert consensus (Crypto Daily, 2026): *"blockchain should be used where it improves the workflow… adding a token can create unnecessary complexity"*; a token *"only makes sense if it has a clear role."* Ours has none.

### What we ship instead (gets 95% of the benefit, 0% of the cost)
- **SHA-256 hash-chained, append-only audit log** — the same construction behind git commits, certificate transparency, and blockchain ledgers. Tamper-evident, ~500ns/hash, **$0, offline, private.** Already in our schema (`audit_log.prev_hash/hash` + `sentinel verify-log`).
- Bonus credibility: **NousResearch's own Hermes Agent has an OPEN issue requesting exactly this feature** (GitHub #487). We'd ship a security guarantee Hermes doesn't have yet.

### The single optional exception (post-launch, opt-in only)
- If a user ever needs to *prove the log to a third party*, integrate **Sigstore/Rekor** (free, keyless transparency log). Sigstore itself only anchors to a chain (Scroll L2) *optionally* to stop split-view attacks. So our ladder is:
  1. **v1:** local hash-chain (default, always on, free).
  2. **Later:** opt-in Sigstore anchoring for public verifiability.
  3. **Only if demanded:** chain anchoring — never required, never default, never our cost.
- **Launch-post angle:** *"I considered blockchain for tamper-proofing. Then I measured it: gas fees, latency, and transparency that leaks your data. So I used hash chains — git's trick — for $0, offline, and private. Here's the math."* (This makes you look *more* serious, not less.)

> ✅ Net: no blockchain in core. Hash-chained audit log = our tamper-evident security, free.

---

## PART B — The name

### Principle
`rrrtx` is **your maker brand / signature** — keep it (e.g. *"by rrrtx"*, `@ahmadrrrtx`, "an rrrtx project"). The **product** needs a name that *says what it does* and is easy to type as a CLI command. Don't make the product literally "rrrtx" — pair them.

### Naming criteria
1. One short word, easy to type as a CLI (`<name> "do x"`).
2. Evokes **trust / guardian / safety** (our core differentiator).
3. Likely available on npm + GitHub (verify before committing).
4. Pairs cleanly with your signature: *"<Name> — by rrrtx."*

### Top candidates (ranked)

| Rank | Name | CLI | Why it fits | Notes |
|---|---|---|---|---|
| 🥇 1 | **Sentinel** | `sentinel` | Guardian that watches & protects — exactly our trust/security story | Common word → likely taken on npm; consider `sentinel-agent` / `sentinelctl` / scope `@rrrtx/sentinel` |
| 🥈 2 | **Aegis** | `aegis` | The mythic shield — "protected by Aegis." Short, premium, security-coded | Check npm; `@rrrtx/aegis` is a safe fallback |
| 🥉 3 | **Warden** | `warden` | A guardian/keeper; friendlier than "sentinel," still security | Good CLI ergonomics |
| 4 | **Bastion** | `bastion` | A stronghold; strong security connotation | Slightly longer to type |
| 5 | **Vanta** | `vanta` | Coined, modern, "vantablack = nothing escapes" (egress/exfil control) | Likely free; brandable |
| 6 | **Keyper** | `keyper` | Pun on key + keeper → BYOK/keychain story; memorable | Very on-brand for "you bring the key" |

### Recommended choice
- **Primary: `Aegis` (CLI: `aegis`)** — short, premium, unmistakably "protection," easy to type, more likely available than "Sentinel," and pairs beautifully: **"Aegis — the AI agent you can trust. by rrrtx."**
- **Safe fallback if names are taken:** publish under your scope → **`@rrrtx/aegis`** (npm scope guarantees availability) with CLI `aegis`.
- Keep all SENTINEL planning docs as-is internally; we just rename the shipped product. (Easy find/replace later.)

### Positioning lines (pick one)
- **Primary:** *"Aegis — the AI agent you can actually trust. BYOK, local-first, spend-capped, tamper-evident. by rrrtx."*
- Shorter: *"Aegis — your agent, your keys, your rules. by rrrtx."*
- Punchy: *"The agent that can't overspend, can't be injected, and never forgets a win. Aegis, by rrrtx."*

### ✅ To do before first commit (you, 2 min)
Check these and tell me which to lock in:
1. `npmjs.com/package/aegis` (and `sentinel`, `warden`, `vanta`, `keyper`)
2. `github.com/aegis` org / repo name
3. If unsure → we use **`@rrrtx/aegis`** scope (always available) + CLI `aegis`.

---

## Decision summary
- **Blockchain:** ❌ not in core. ✅ SHA-256 hash-chained audit log (free, offline, private). 🔓 optional Sigstore anchoring later.
- **Name:** Product = **Aegis** (fallback `@rrrtx/aegis`), CLI `aegis`; **rrrtx = your maker signature**. Tagline: *"the AI agent you can actually trust — by rrrtx."*
- **Next:** confirm the name (quick availability check), then I start building Phase 0 under that name.
