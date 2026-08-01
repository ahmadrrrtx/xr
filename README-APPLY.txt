XR PHASE 4 - ROUND 3.1 CI FIX (typecheck error fixed)
========================================================
Your PR #36 (fix/phase4-ci-round3) is already pushed and the Supply Chain
checks all PASS. The only remaining failure is Typecheck (which also fails
the macOS/Windows typecheck jobs and the Quality Gate aggregation):

  src/daemon/server.ts(350,5): error TS2322:
    Type 'number | undefined' is not assignable to type 'number'.

Root cause: @types/bun types Bun.serve()'s `server.port` as
`number | undefined`, but I assigned it to `const boundPort: number`
without a fallback.

Fix (ONE line in src/daemon/server.ts):
  const boundPort = server.port;   ->   const boundPort = server.port ?? port;

Verified locally:
  - bunx tsc --noEmit   -> 0 errors
  - bun test            -> 2358 pass / 0 fail
  - perf dashboard-bench with port 0 -> works (ephemeral port assigned)

APPLY (you are on branch fix/phase4-ci-round3):
  cd /c/Users/Admin/.xr-agent
  git checkout fix/phase4-ci-round3        # if not already on it
  unzip -o ~/Downloads/xr-phase4-fix-round3.zip -d .
  rm README-APPLY.txt CHANGED-FILES.txt    # if present (already deleted on this branch - skip if gone)
  git status                                # expect ONLY: modified src/daemon/server.ts
  git add -A
  git commit -m "fix(phase4): typecheck - server.port may be undefined; fall back to requested port"
  git push
  gh pr checks --watch
  gh pr merge --squash --delete-branch
  git checkout main && git pull origin main
