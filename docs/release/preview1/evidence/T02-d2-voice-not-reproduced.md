# T02 / D2 — evidence: the reported voice-probe failure does not reproduce

Priority P1 · plan source 3/D2 · status: **NOT REPRODUCED** (no defect found at base commit)

## The claim (plan section 3, D2)

> **D2 (P1): failing test** `test/voice/status-probe.test.ts:111`. The test deletes
> `GROQ_API_KEY` but voice status still reports "key present". Decide: stale cache or
> secret-broker lookup bug in the product, or test pollution. Fix the cause, not the assertion.

## What the code at line 111 actually asserts

```ts
process.env.GROQ_API_KEY = "REDACTED-TEST-KEY";
const withKey = await checkVoiceStack(settings({ sttBackend: "groq", allowCloudStt: true }), { fetcher: impl });
expect(lines(withKey)[0]).toBe("Speech-to-text: ? groq: cloud key present — cloud, not contacted");
delete process.env.GROQ_API_KEY;
const noKey = await checkVoiceStack(settings({ sttBackend: "groq", allowCloudStt: true }), { fetcher: impl });
expect(lines(noKey)[0]).toBe("Speech-to-text: ! groq: missing GROQ_API_KEY");
```

## Results — five different ways to reproduce it, all green

| Scenario | Command | Result |
|---|---|---|
| file alone | `bun test test/voice/status-probe.test.ts` | `8 pass, 0 fail` |
| whole directory | `bun test test/voice/` | `41 pass, 0 fail` |
| whole suite, one process (~5300 tests) | `TMPDIR=… bun test` | voice file still passes; `0` voice failures |
| **ambient key exported at process start** (the likely state of the builder's shell) | `GROQ_API_KEY=sk-ambient-test bun test test/voice/status-probe.test.ts` | `8 pass, 0 fail` |
| **a real `XR_HOME` config carrying a groq provider block** (the "stale cache" theory) | `XR_HOME=… bun test test/voice/status-probe.test.ts` | `8 pass, 0 fail` |

The two hypotheses the plan asked to decide between — *stale cache / secret-broker lookup bug*
and *test pollution* — were each set up deliberately, and neither produces the reported
symptom at commit `1834fd16`.

## Conclusion

- **Fact:** at base commit `1834fd16` the test passes in every configuration tried, including
  the two that would expose a cache or broker bug. There is no observable defect to fix.
- **Inference:** the observation recorded in the plan was made against an earlier commit, or on
  a machine whose environment differs in a way this box cannot reconstruct. It is not a
  property of the code at the release base.
- **Action:** no code change. The test is not weakened or deleted — it stays exactly as it was
  and keeps guarding the behaviour. If it fails in CI at G1, that run is the evidence to act
  on, and this ledger line will be reopened with the CI log.

## Note on `test/voice` elsewhere in the suite

`test/release` runs 288 tests with 11 skips and `test/trust` 159 with 17 skips in this
environment (no `bwrap`, no audio device). Those skips are listed in the Day-1 baseline, not
counted as passes.
