# XR 3.1F — CONTROL CENTER MIGRATION & RELEASE NOTES
> Upgrading Mission Control to v3.1F Stable

This document contains:
1. Migration notes for upgrading users and developers.
2. Official v3.1F Release Notes.

---

## 1. Migration Notes

The XR v3.1F Control Center redesign preserves 100% compatibility with existing backend systems. No database migrations, schema alterations, or kernel changes are required.

### 1.1 Local Installation and Upgrade Path

For existing local users, the upgrade to the new Control Center interface is seamless:

```bash
# 1. Pull the latest release
git pull origin main

# 2. Re-compile local server daemon (Bun)
bun install

# 3. Check system health
xr doctor

# 4. Boot the new Control Center daemon
xr serve
```

### 1.2 Configuration Compatibility

Config values located at `~/.xr/config.json` are fully respected:
- Cloud provider API keys are read from the standard local encrypted stores.
- Spent budgets, monthly caps, and auto-fallback gates remain fully intact.
- Installed local models inside Ollama directories are automatically scanned on startup and synced directly to the Models manager view.

---

## 2. Release Notes (XR v3.1F — Mission Control)

### "The AI Operating System, Refined and Transparent."

XR v3.1F is a milestone release delivering **Mission Control**, a premium, high-density, unified control panel designed to provide full visibility and governance over your AI workspace.

### Key Highlights
- **12-Subsystem Bento Health Matrix**: Real-time monitor of connection, model, local Ollama connectivity, voice pipeline, sandboxed plugins, MCP servers, memory, Shield, computer control, active tasks, research, and update packages visible on the Home landing pane.
- **Dojo Security Laboratory**: Simulated prompt injection runner testing local filters.
- **Process EDR System**: Real-time listing of running processes with secure PID termination directly from the security dashboard.
- **Universal Composer Integration**: A single text input supporting conversational turns, `/` commands, `@` context references, and responsive tool execution feeds.
- **Liquid Layout Design**: Liquid resizing that matches terminal-width boundaries perfectly. Fully offline-safe inline SVG icons.
- **Keyboard Mnemonic Navigation**: Linear-style navigational chords (`g + d`, `g + c`, `g + s`, etc.) and a global command palette overlay (`Cmd+K`).
- **Zero-Telemetry Policy**: Local-first operation. No data leaves your workstation without audit tracking.
