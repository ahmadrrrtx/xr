# Owner-authorized source submission —2026-10-27

The owner subsequently authorized committing/pushing the implementation to the
GitHub repository and opening a PR into protected main. The earlier candidate
report/evidence is a **pre-source-submission local verification snapshot**; its
no-commit/no-push statements describe that phase, not a prohibition on this
new owner-authorized source handoff.

## Scope and identity

* Authenticated account verified as `ahmadrrrtx`, GitHub public user ID273549977;
  requested repository `ahmadrrrtx/xr`, push permission confirmed.
* Main is protected and still at basee25afd362e80485340a322e60a97a04d41b6bd51
  when checked. Preserve protection: push the audit branch and open a PR into
  main, never force-push/bypass required reviews or pretend failing CI passed.
* Commit identity uses the requested login and its actual ID-based GitHub
  noreply address; no invented personal email or global Git identity change.
* No tags/releases/npm/default channel/updater mutation is authorized by this
  source submission. Candidate remains1.1.1-rc.1/developer-preview.
* Authentication is temporary and outside the repository. The credential must
  not enter Git URLs/config/argv/source/logs. The owner should revoke/rotate the
  chat-exposed token after the requested GitHub operation; do not paste a
  replacement into a public issue, PR or terminal command.

## Windows-local prerequisite correction

Preparing the owner's Windows signing instructions exposed a local native
sidecar issue: Node/Bun reports `process.platform === win32`, while the existing
compile table used the `windows-*` vocabulary. `resolveCompile` now normalizes
that alias. Added native x64/arm64 and cross-target regression cases.

This does not claim Windows execution from Linux. The original5007-test input
snapshot remains preserved; this small post-report script amendment was checked
separately:

* sidecar + release enforcement:19PASS/0FAIL/111assertions;
* bounded Node TypeScript check: exit0,20.132s,1008516KiB peak;
* identity/channel/CI-policy/diff checks: exit0.

Exact amendment output is under `evidence/github-handoff-2026-10-27/`. GitHub CI
on the actual PR head is the new remote evidence, not the old base SHA alone.
The actual submitted commit/PR/check URLs are reported after push, so this
commit does not contain a made-up self-referential SHA or an invented CI PASS.

## Windows signing next step

Use [WINDOWS_LOCAL_SIGNING_PROMPT.md](WINDOWS_LOCAL_SIGNING_PROMPT.md) in
Antigravity on the owner's Windows machine. It requires a real certificate/key
provider, an exact reviewed PR head and explicit owner approval. It prohibits
secret export/argv, self-signed production claims, disabled validation and
publishing. Local Authenticode is separate from this repository's production
GitHub signing/provenance/native gates; a hardware-only local signer needs a
reviewed integration rather than pretending CI secrets are provisioned.


## Submission packaging hygiene

A pre-push review restored two baseline executable bits lost in a workspace
snapshot (apply-branch-protection.sh and assert-clean-tree.sh). It also explicitly
included the dated audit evidence logs that the repository's generic *.log
ignore would otherwise omit. Only docs/release/evidence logs were added; a
credential/private-key/PAT/bearer-material tripwire scan found no such material,
and the actual current credential occurs in none of the repository/evidence
files. No claim of a complete secret certification is inferred from that scan.
These corrections are separate commits, not a history rewrite/force push.

## CI follow-up — 2026-10-27

The originally linked run is historical: subsequent commits fixed its required
mutation, security, truth, cross-platform and supply-chain gates. On the newer
`764e3b68` run, the required Quality Gate failed because a hook in
`test/api/v1-versioning.test.ts` exceeded Bun's five-second default. The log
identifies a hook timeout, not a failed API assertion; it does not prove why the
runner was slow. That suite now closes each independent SQLite store, restores
its temporary home and gives fixture setup/cleanup a bounded 20-second budget.
The API directory passed locally (115 tests, no retries).

The three reported, non-gating Linux ARM64 journeys still failed while the
file authority refused to initialize. Linux ARM64 uses different `O_DIRECTORY`
and `O_NOFOLLOW` bits from x64. Under QEMU user-mode ARM64, the earlier code
reproduced an `openat2` EINVAL with x64 flags; the candidate maps the logical
flags to the correct ABI without changing the kernel's resolution constraints
or adding a fallback. On this x64 Linux host, 23 ARM64-emulated filesystem
regressions passed with a 20-second per-test limit and an explicit QEMU wrapper
for child Bun processes. Local Linux x64 security regressions and the binary
and npm clean-machine CLI journeys also passed. Emulation is not native or
release evidence. `journey.yml` now runs the file-authority regression suite
on a native ARM64 runner before the binary journey; the npm and Docker legs
exercise their own payloads. All three remain non-gating under the existing
owner decision pending reviewed native evidence. No release, tag, channel
promotion or branch-protection change is authorized by this follow-up.
