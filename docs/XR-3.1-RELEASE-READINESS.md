# XR 3.1 — UX Validation & Release Readiness Checklist

## UX validation checklist

## Fresh install / first launch
- [ ] install XR on a clean machine
- [ ] run `xr onboarding`
- [ ] confirm platform snapshot appears
- [ ] confirm local/cloud/hybrid recommendation makes sense
- [ ] confirm config writes successfully
- [ ] run `xr`
- [ ] confirm fullscreen shell opens
- [ ] confirm startup picker is visible

## TUI validation
- [ ] `Tab` cycles views
- [ ] `Ctrl+K` opens command palette
- [ ] `Ctrl+N` opens notification center
- [ ] `Ctrl+J` opens quick actions
- [ ] `Ctrl+W` reopens workspace picker
- [ ] arrow-key navigation works in startup overlay
- [ ] slash commands route correctly
- [ ] plain prompts route to agent execution
- [ ] memory intents are intercepted and rendered inline
- [ ] approval modal appears for risky actions
- [ ] budget warning path is understandable

## Dashboard validation
- [ ] `xr serve` binds to localhost only
- [ ] dashboard loads with token auth
- [ ] active provider chip matches real provider/model
- [ ] provider overview card shows live health
- [ ] settings panel reflects config values
- [ ] sessions endpoint resolves
- [ ] workspaces endpoint resolves
- [ ] memory panel search works
- [ ] audit log still renders

## Website validation
- [ ] homepage renders with local logo and avatar
- [ ] preview works without Google Fonts access
- [ ] main CTA links still work
- [ ] layout still behaves responsively

## Accessibility validation
- [ ] TUI can be operated without mouse
- [ ] overlays are dismissible with `Esc`
- [ ] key shortcuts are visible in-product
- [ ] dashboard remains readable with system fallback fonts

---

## Release readiness checklist

### Functional
- [ ] `xr`
- [ ] `xr help`
- [ ] `xr onboarding`
- [ ] `xr serve`
- [ ] one-shot run path
- [ ] dashboard auth path
- [ ] memory read/delete API
- [ ] provider health API

### Product quality
- [ ] launch feels instant enough
- [ ] no placeholder provider state remains on dashboard overview
- [ ] onboarding copy is concise and confidence-building
- [ ] fullscreen shell feels visually coherent
- [ ] shell state is always legible

### Reliability
- [ ] shell exits cleanly
- [ ] server stops cleanly on SIGINT
- [ ] workspace switching does not corrupt state
- [ ] provider failure paths explain what happened

### Documentation
- [ ] changelog entry added
- [ ] README launch instructions updated if desired
- [ ] screenshots refreshed for TUI if publishing release notes
- [ ] migration note shared with existing users

### Known follow-up items
- [ ] deeper Bun-native profiling in a Bun-enabled environment
- [ ] richer dashboard session/project management actions
- [ ] expanded provider manager mutations in Mission Control
- [ ] stronger end-to-end tests for the new fullscreen shell
