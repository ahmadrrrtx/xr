HOW TO APPLY (Windows Git Bash)
==================================
1. Open Git Bash and go to your repo:
     cd /c/Users/Admin/.xr-agent

2. Make sure your working tree is CLEAN and your main matches GitHub:
     git fetch origin
     git status                 # must say "nothing to commit, working tree clean"
     git log -1 --oneline origin/main    # should be c9332f5 (Phase 3 head)

3. Create the PR branch from origin/main:
     git checkout -b phase4/security-trust-hardening origin/main

4. Extract THIS zip INTO THE REPO ROOT so every file lands at its correct
   path (answer 'y' to overwrite prompts; there are none if the tree is clean):
     unzip xr-phase4-changes.zip -d .

5. Verify what changed:
     git status          # ~54 modified + ~28 new files
     git diff --stat

6. Stage, commit, push:
     git add -A
     git commit -m "feat(phase4): security & trust hardening - enforceable isolation, egress proxy, credential brokering, dashboard hardening, supply chain"
     git push -u origin phase4/security-trust-hardening

7. Open a pull request (CI runs on it):
     gh pr create --base main --head phase4/security-trust-hardening        --title "Phase 4 - Security & Trust Hardening"        --body "Enforceable risk-tiered isolation (lattice), centralized egress proxy, credential brokering, dashboard hardening, supply-chain assurance (SBOM/SLSA/cosign)."
   (or push and click the 'Compare & pull request' button GitHub shows)

8. Watch CI until green:
     gh pr checks --watch

9. Merge when green:
     gh pr merge --squash --delete-branch
   then:
     git checkout main && git pull origin main

NOTES
- Line endings: .gitattributes forces eol=lf, so no CRLF noise.
- Do NOT extract this zip anywhere else or copy files by hand - extract at
  the repo root only.
- If git status shows extra files you did not expect, STOP and compare with
  CHANGED-FILES.txt inside this zip.
