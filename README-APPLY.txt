XR PHASE 4 - CI-FIXED CHANGE SET (round 2)
=============================================
Build: 2026-08-01 (after fixing the remaining 2 failing GitHub checks)

ROUND-2 FIXES (your PR #35 still failing on 2 Supply-Chain jobs):

1. Supply Chain / Container image scan (trivy)  - FIXED in Dockerfile
   The oven/bun:1-alpine base image carried 2 HIGH findings with fixes:
   CVE-2026-45447 (libcrypto3/libssl3 3.5.6-r0 -> 3.5.7-r0, OpenSSL
   Heap Use-After-Free in PKCS7_verify). The floating tag lags alpine
   security releases. Fix: `RUN apk upgrade --no-cache` in the Dockerfile
   patches the base at BUILD time (verified: alpine 3.22 repo has 3.5.7-r0,
   trivy then reports 0 HIGH/CRITICAL).

2. Supply Chain / Vulnerability scan (osv-scanner + npm audit) - FIXED
   a) google/osv-scanner-action@v2.3.8 is BROKEN upstream: its action.yml
      has no 'runs:' section (GitHub: "Top level 'runs:' section is
      required"). Fix: dropped the action; the workflow now downloads the
      osv-scanner v2.4.0 binary (sha256-pinned) and runs it directly.
   b) npm audit FAILED with ENOLOCK (repo uses Bun's bun.lock, no
      package-lock.json at root). Fix: replaced with `bun audit`.
   c) The scan then surfaced 15 real vulnerabilities - ALL in website/
      (next@16.2.10, postcss 8.4.31 pinned by next, sharp 0.34.5, and two
      brace-expansion lines). Fixed by:
         - website/package.json: next 16.2.10 -> 16.2.12 (latest patched),
           eslint-config-next matched, and npm overrides:
             postcss 8.5.25 (CVE-2026-45623 + GHSA-r28c-9q8g-f849 fixed),
             sharp 0.35.0 (inherited libvips CVEs fixed only in 0.35.0),
             minimatch@3.1.5 -> brace-expansion 1.1.18,
             minimatch@10.2.5 -> brace-expansion 5.0.8.
         - website/package-lock.json regenerated.
   Verified locally: full-repo osv scan = 0 results (exit 0), bun audit =
   "No vulnerabilities found", website `npx tsc --noEmit` PASS,
   `npm run build` PASS (all routes prerendered).

NOTE for you: your local working tree already has the ROUND-1 zip applied
(that's your current commit on the PR branch). THIS zip is a SUPERSET -
applying it again will update the 4 round-1 files + add the 3 round-2 files
(Dockerfile, website/package.json, website/package-lock.json) and update
supply-chain.yml. git add -A will only stage the new/updated files.

APPLY (you are on phase4/security-trust-hardening already):
   cd /c/Users/Admin/.xr-agent
   git checkout phase4/security-trust-hardening
   unzip xr-phase4-changes.zip -d .        # overwrite - all files
   git status                               # verify
   git add -A
   git commit -m "fix(phase4): CI round 2 - trivy base-image patch (apk upgrade); osv-scanner binary + bun audit; website dep bumps + overrides"
   git push
   gh pr checks --watch
   gh pr merge --squash --delete-branch
   git checkout main && git pull origin main
