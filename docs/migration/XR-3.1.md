# XR 3.1 — Migration Guide

## What changed

XR 3.1 changes product behavior more than product capability.

### Biggest user-visible change

`xr` now launches the dedicated fullscreen TUI by default.

Before:
- `xr` showed the lightweight CLI/help experience.

Now:
- `xr` opens the fullscreen XR shell.

---

## Command behavior changes

### `xr`

Now opens the fullscreen TUI.

### `xr help`

Still opens help directly.

### `xr serve`

Still launches the local dashboard/chat server directly.

### `xr onboarding`

Now runs the dedicated onboarding wizard instead of routing through the generic install flow.

---

## Recommended user update message

If you announce XR 3.1 to existing users, use language like:

> XR now opens into a dedicated fullscreen shell by default. If you want quick docs, use `xr help`. If you want the browser control center, use `xr serve`.

---

## Existing workflows

### One-shot tasks

No change:

```bash
xr "write a README"
```

still runs a one-shot task.

### Full terminal workspace

Still available, but now also the default:

```bash
xr
xr --tui
```

### Dashboard

No command change:

```bash
xr serve
```

---

## Operator notes

### For docs and screenshots

Update docs/screenshots that previously implied:

- `xr` → help screen

Replace with:

- `xr` → fullscreen XR shell
- `xr help` → command reference

### For onboarding content

Update docs to recommend:

```bash
xr onboarding
```

for setup-specific flows.

### For terminal automation / scripts

If a script previously invoked bare `xr` expecting help output, switch it to:

```bash
xr help
```

---

## Compatibility

This release is intentionally additive in capability and disruptive only in product posture.

### Not changed
- provider architecture
- memory architecture
- research engine
- plugin runtime
- MCP runtime
- dashboard route structure
- website route structure

### Changed
- default launch surface
- onboarding command routing
- dashboard data fidelity
- website preview portability

---

## Rollback expectation

If a user strongly prefers the previous behavior, document this temporary workaround:

```bash
xr help
```

for a lightweight non-TUI entry.

If a future release wants explicit opt-out behavior, a dedicated flag like:

```bash
xr --cli
```

could be added later, but that is not part of this XR 3.1 pass.
