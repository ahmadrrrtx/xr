# 1.1.1-rc.1 — developer-preview limitations

This is an uncommitted implementation candidate, NOT a verified public or stable
release. No tag/package/release was published by this work. Stable public
defaults remain1.0.0; the withdrawn1.1.0 owner repair remains outstanding.

* Linux source/runtime regressions are recorded in [PROGRESS](../PROGRESS.md);
  the final [candidate report](../RELEASE_CANDIDATE_REPORT.md) is the readiness
  authority once generated. Do not infer platform passes from source contracts.
* Full native Tauri/GUI/install/upgrade/uninstall and actual OS keychains need
  platform runners. This Linux sandbox lacks GTK3/WebKit4.1 headers. The
  pinned CI compiler is1.99.1; the declared1.77 MSRV is NOT validated here.
* Production Developer ID/notarization, Authenticode, updater keys and package
  registry/tap/community accounts are owner prerequisites. Tag candidates fail
  closed when required signing is missing. Updater is unprovisioned.
* CI source now exercises same-version reinstall/data retention, not a claimed
  executed cross-version or automatic-update lifecycle. Neither ran here.
* Provider facts are sourced, not live authentication/agent-quality proof.
  Credential presence is not authentication; Auto does not upgrade that claim.
  No model weights, paid live suite or competitor benchmark were run.
* Dollar thresholds are admission estimates, not invoice ceilings. Unknown
  rates require explicit sourced/operator tariff, including when USD thresholds
  are disabled. Provider premiums/cache/tokenizers may differ from estimates.
* Linux process limits are per-process, NOT aggregate cgroup quotas. Sandboxes
  refuse unsupported requested controls. Native non-Linux isolation needs its
  own evidence and is not implied by Linux namespaces.
* Sealed-file fallback has a nearby private key: not protection against an
  attacker reading the whole data home. Removal is not backup/environment/vendor
  revocation or guaranteed physical erasure. Cross-store atomicity is limited.

See [SECURITY_AUDIT](../SECURITY_AUDIT.md), [RELEASE_AUDIT](../RELEASE_AUDIT.md),
[desktop lifecycle/storage guidance](../../../desktop/README.md) and
[benchmark scope](../../../benchmarks/agent/README.md).
