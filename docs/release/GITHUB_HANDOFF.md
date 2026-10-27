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
