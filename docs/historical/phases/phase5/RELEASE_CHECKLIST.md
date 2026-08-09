# XR 4.4.0 Release Checklist — Universal Intelligence Plane

## Version

- [x] `package.json` → 4.4.0  
- [x] `src/core/version.ts` → Universal Intelligence Plane  
- [x] `website/src/lib/site.ts` stamped  
- [x] `bun run set-version:check` green  

## Quality gates

- [x] `bun run typecheck`  
- [x] `bun test` — 746 pass; 2 env-only trust sandbox fails (pre-existing)  
- [x] Intelligence unit + routing + integration + perf tests  

## Security / policy

- [x] Local-only hard filter  
- [x] Pin cannot bypass locality/security policy  
- [x] No credential leakage in decision records  
- [x] Fallback cannot silently escalate to cloud  
- [x] unknown_completion cannot auto-fallback  

## Compatibility

- [x] `buildProvider` / `getProvider` API preserved  
- [x] Config migration 13→14 additive  
- [x] Phase 0–4 behavior intact  

## Docs

- [x] Architecture  
- [x] Developer guide  
- [x] User guide  
- [x] Migration 4.3→4.4  
- [x] Validation report  

## Sign-off

| Role | Status |
|---|---|
| Runtime | Ready |
| Routing | Ready |
| Security/privacy | Ready |
| Release | Ready |
