# XR 3.1F — OPERATING USER MANUAL (DOCUMENTATION UPDATES)
> Deploying, Navigating, and Hardening the Mission Control Center

This document provides updated operating user manuals for deploying, navigating, and managing XR's Mission Control Center.

---

## 1. Quick Start and Deployment

To spin up the Mission Control Center locally:

```bash
# Start the local daemon and serve the Control Center
xr serve
```

Upon boot, the server daemon prints a local-binding loopback URL with a unique local bearer token:

```
  XR — Local Server
  ✓ Listening on  http://127.0.0.1:3141
  ✓ Dashboard     http://127.0.0.1:3141/?token=xxxxxx
  ✓ Chat          http://127.0.0.1:3141/chat?token=xxxxxx
```

Open this URL in any modern browser to enter the **Mission Control Center**.

---

## 2. Navigating the 24 Dashboard Views

The sidebar menu partitions operations into five logical, high-signal groups:

### 2.1 Mission Hub
- **Home**: The central command deck. Monitor real-time cost, Dojo safety ratings, and look over the 12-subsystem Bento Health Matrix.
- **Chat Sessions**: Your primary composer desk. Toggle memories, plans, research, and security shields before executing.
- **Recent Sessions**: Drill down into past automated job steps.
- **Workspaces**: Switch between isolated developer directory profiles.

### 2.2 AI Resources
- **Providers (BYOK)**: Manage API keys with obscured secure fields. Test latency and estimate costs.
- **Models (Local AI)**: Calculator recommending models based on local CPU/RAM specs. Smoke test Ollama connections.
- **Durable Memory**: Timeline browser for persistent vector memories. Search and delete entries.
- **Research Runs**: Citation and contradiction reporter for deep search.
- **Voice Pipeline**: Directions for activating wake-phrase detectors.

### 2.3 Platforms & Tools
- **Skills Marketplace**: App Store catalogs of specialists skills (React dev, SOC analyst). Review permissions before enabling.
- **Sandboxed Plugins**: Turn code integrations on/off and manage permissions.
- **MCP Servers**: Register Model Context Protocol nodes to connect external tool databases.
- **Business OS CRM**: Enterprise operational indicators templates.

### 2.4 Governance & Trust
- **Computer Control**: Monitor JARVIS actions and manage pending approvals (Allow/Deny). Includes an Emergency Stop button.
- **Shield (Security)**: Advanced EDR scanning, live process tree management to terminate PIDs, startup tasks validation, Downloads files scanner, cookie metrics audit, and Dojo injection test lab.
- **Audit Log**: Immutable ledger and verify chain integrity.
- **Cost & Budget**: Set task cost caps and monthly thresholds.
- **Files & Artifacts**: File browser for generated files.
- **Downloads Security**: Downloads folder risk logger.
- **Devices Link**: Sync mobile Termux clients and VS Code extensions.

### 2.5 Core Services
- **Scheduled Tasks**: Configure cron scheduled jobs.
- **Webhooks API**: List webhooks.
- **Alerts Hub**: System warnings list.
- **Core Settings**: Category forms list (General, Keys, Budget, Trust) with instant settings search.
- **About Build**: System build version, PK localization, data export.
