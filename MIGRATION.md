# XR Migration Guide

## XR 3.1.5 → XR 3.1.6 (Baseline Integrity)

XR 3.1.6 is a Phase 0 baseline release. It adds diagnostics, validation/release artifacts, support classification, and documentation corrections. It does **not** introduce a destructive workspace database migration.

### Compatibility

- Package name remains `@rrrtx/xr` and CLI bin remains `xr`.
- Existing workspace SQLite data remains compatible.
- Existing provider configuration, memory consent behavior, budget controls, daemon localhost/token behavior, and plugin/skill/MCP compatibility are preserved.
- Docker default daemon port is now explicitly `7842` to match the Dockerfile/compose mapping.

### Upgrade steps

```bash
cd /path/to/xr
git pull --ff-only origin main
bun install --frozen-lockfile
bun run set-version:check
bun run baseline:validate
xr doctor --json
```

For package-manager installs, install `@rrrtx/xr@3.1.6` using your package manager, then run `xr doctor --json`.

### Backup before upgrade

Back up `XR_HOME` before upgrading. Default is `~/.xr` unless overridden.

```bash
XR_HOME_DIR="${XR_HOME:-$HOME/.xr}"
tar --exclude='.env' -czf "xr-backup-$(date +%Y%m%d-%H%M%S).tgz" -C "$(dirname "$XR_HOME_DIR")" "$(basename "$XR_HOME_DIR")"
```

The backup should include workspace databases, workspace configuration, installed capability metadata, and non-secret config references. Do not export plaintext secrets unless your local security policy requires an encrypted full backup.

### Rollback

If validation fails, stop XR processes, restore the pre-upgrade backup, and reinstall/check out the known-good 3.1.5 artifact or commit. See `docs/release/3.1.6/ROLLBACK.md`.

### Known upgrade failures and recovery

- `bun install --frozen-lockfile` fails: do not continue; restore code/package to the previous release or regenerate lockfile only as an explicit release decision.
- `xr doctor --json` reports a required failure (`platform`, `bun`, `package-manager`, `config`, `audit`): follow the remediation in the JSON output before publishing or continuing upgrade.
- Optional provider/local-runtime/browser/voice/control warnings do not block core local operation unless your workflow depends on that optional component.

---

# Security Fix Migration Guide

## Overview

This guide describes how to migrate XR to the new secure architecture that closes the two critical RCE vectors:

1. **Plugin sandbox bypass** (regex-based scanning → VM isolation)
2. **Playwright `--no-sandbox`** (disabled by default → enabled by default)

## Breaking Changes

### For Plugin Developers

1. **Plugins can no longer use `require()` or `import()`**
   - ✅ Use `host.fs`, `host.net`, `host.secrets` instead
   - ❌ `const fs = require("fs")` will fail in VM context

2. **Plugins can no longer access `process.env`**
   - ✅ Use `host.secrets.get("API_KEY")` instead
   - ❌ `process.env.API_KEY` will be undefined in VM context

3. **Plugins can no longer use `eval()` or `new Function()`**
   - ❌ These will throw errors in VM context

### For Users

1. **Browser will run with sandbox enabled by default**
   - If you previously needed `--no-sandbox` (e.g., running as root in Docker), set:
     ```bash
     export XR_BROWSER_UNSAFE=1
     ```
   - ⚠️  **WARNING**: Only set this in development/isolated environments

2. **MCP servers will no longer inherit full environment**
   - If your MCP server needs specific env vars, declare them in `xr-plugin.json`:
     ```json
     {
       "mcpServers": [{
         "id": "my-server",
         "transport": "stdio",
         "command": "node",
         "args": ["server.js"],
         "env": {
           "API_KEY": "${MY_API_KEY}"
         }
       }]
     }
     ```

## Migration Steps

### Step 1: Update XR

```bash
cd /path/to/xr
git pull origin main
npm install
```

### Step 2: Audit Existing Plugins

Run the plugin security audit:

```bash
xr plugins audit --security
```

This will check all installed plugins for:
- Use of disallowed imports
- Direct `process.env` access
- Use of `eval()` or `new Function()`
- File traversal attempts

### Step 3: Update Plugin Code

For each plugin that fails the audit, update the code:

#### Before (Insecure):

```typescript
import fs from "node:fs";
import { exec } from "node:child_process";

export async function activate(host) {
  const apiKey = process.env.API_KEY;  // ❌ Insecure
  
  const data = fs.readFileSync("/etc/passwd");  // ❌ Insecure
  
  exec("rm -rf /");  // ❌ Very insecure
  
  return {
    tools: [{
      name: "my-tool",
      run: async (args) => {
        const response = await fetch("https://api.example.com");  // ❌ Insecure
        return { ok: true, output: "Done" };
      }
    }]
  };
}
```

#### After (Secure):

```typescript
export async function activate(host) {
  // ✅ Use host.secrets for API keys
  const apiKey = host.secrets?.get("API_KEY");
  
  // ✅ Use host.fs for file access (sandboxed to plugin data dir)
  const data = host.fs?.read("data.txt");
  
  // ✅ Use host.net for network access (egress filtered)
  const response = await host.net?.fetch("https://api.example.com");
  
  return {
    tools: [{
      name: "my-tool",
      run: async (args) => {
        // Your logic here (no direct access to fs/process/net)
        return { ok: true, output: "Done" };
      }
    }]
  };
}
```

### Step 4: Update Plugin Manifest

Ensure your `xr-plugin.json` declares the correct permissions:

```json
{
  "id": "my-plugin",
  "permissions": [
    "fs:read",     // If you use host.fs.read
    "fs:write",    // If you use host.fs.write
    "net",         // If you use host.net.fetch
    "secrets"      // If you use host.secrets.get
  ]
}
```

### Step 5: Test Browser Security

If you use browser automation, test that it works with sandbox enabled:

```bash
# Test browser with sandbox (default)
xr control browser test

# If it fails (e.g., running as root in Docker), you can temporarily disable:
export XR_BROWSER_UNSAFE=1
xr control browser test
```

⚠️  **NOTE**: Running with `XR_BROWSER_UNSAFE=1` should only be done in isolated development environments.

### Step 6: Test MCP Servers

If you use MCP servers, verify they still work with the allow-listed environment:

```bash
xr mcp test --server my-server
```

If the MCP server needs additional environment variables, add them to the allow-list:

```typescript
// In your plugin code or XR config
const allowedEnv = createAllowedEnvironment({
  "CUSTOM_VAR": "value"  // Explicitly pass needed vars
});
```

## New Security Features

### 1. VM-Based Plugin Isolation

Plugins now run in isolated `node:vm` contexts:

```typescript
// Plugin code runs here (isolated)
const context = createContext({
  console: { ... },
  JSON: JSON,
  Math: Math,
  // NO access to require, process, fs, net, etc.
});

const script = new Script(pluginCode);
script.runInContext(context);  // Isolated execution
```

### 2. Browser Sandbox Enforcement

Browser now runs with sandbox enabled by default:

```typescript
// Before (insecure):
const browser = await pw.chromium.launch({
  args: ["--no-sandbox", "--disable-setuid-sandbox"]  // ❌
});

// After (secure):
const browser = await pw.chromium.launch({
  args: ["--enable-sandbox"],  // ✅ Sandbox enabled
});
```

### 3. MCP Environment Allow-listing

MCP servers now receive a minimal environment:

```typescript
// Before (insecure):
const env = { ...process.env, ...customEnv };  // ❌ Leaks secrets

// After (secure):
const env = createAllowedEnvironment(customEnv);  // ✅ Only allowed vars
```

## Verification

### 1. Verify Plugin Isolation

```bash
# Run plugin in test mode
xr plugins test --plugin my-plugin --isolation-check

# Should see:
# ✅ Plugin cannot access require()
# ✅ Plugin cannot access process.env
# ✅ Plugin cannot use eval()
```

### 2. Verify Browser Sandbox

```bash
# Check browser launch args
xr control browser status

# Should show:
# security:
#   sandbox: "enabled"
#   headless: false
```

### 3. Verify MCP Environment

```bash
# Check MCP server environment
xr mcp status --server my-server

# Should show:
# env:
#   PATH: "..."
#   XR_DEBUG: "..."
#   # NOT process.env.*
```

## Rollback Plan

If you encounter issues after migration:

### Option 1: Disable VM Isolation (Not Recommended)

```bash
# Set env var to use old loading mechanism
export XR_PLUGIN_VM_ISOLATION=0
```

⚠️  **WARNING**: This disables the primary security boundary!

### Option 2: Disable Browser Sandbox (For Development Only)

```bash
export XR_BROWSER_UNSAFE=1
```

⚠️  **WARNING**: Only use this in isolated development environments!

### Option 3: Allow All Env Vars for MCP (Not Recommended)

```bash
# No direct option - update code to pass needed vars explicitly
```

⚠️  **WARNING**: This weakens MCP server security!

## Common Issues

### Issue 1: Plugin Fails to Load

**Symptom**: `plugin load failed: require is not defined`

**Cause**: Plugin uses `require()` or `import()`

**Fix**: Update plugin to use `PluginHost` API instead

### Issue 2: Browser Fails to Launch

**Symptom**: `Failed to launch browser: No usable sandbox!`

**Cause**: Running as root without `--no-sandbox`

**Fix** (Development only):
```bash
export XR_BROWSER_UNSAFE=1
```

**Fix** (Production): Run as non-root user, or use Docker with proper user namespace.

### Issue 3: MCP Server Fails to Start

**Symptom**: `MCP server exited with code 1`

**Cause**: MCP server needs environment variables that aren't allow-listed

**Fix**: Add needed vars to `xr-plugin.json`:
```json
{
  "mcpServers": [{
    "id": "my-server",
    "env": {
      "NEEDED_VAR": "${ENV_VAR_NAME}"
    }
  }]
}
```

## Security Audit

After migration, run a full security audit:

```bash
# Audit plugins
xr audit plugins --deep-scan

# Audit browser config
xr audit browser

# Audit MCP config
xr audit mcp

# Generate security report
xr audit report --output security-report.pdf
```

## FAQs

### Q: Will my existing plugins still work?

A: Plugins that only use the `PluginHost` API will work unchanged. Plugins that directly access `fs`, `process`, etc. will need to be updated.

### Q: Is the VM isolation 100% secure?

A: VM isolation is a strong security boundary, but not perfect. For defense-in-depth, we also use static scanning, hash verification, and permission enforcement. Future releases will add process-based isolation (Docker/MicroVM).

### Q: Can I still use `--no-sandbox` for browser?

A: Yes, but only with explicit opt-in (`XR_BROWSER_UNSAFE=1`). This should only be used in development/isolated environments.

### Q: How do I debug plugins now?

A: Use `host.log()` and `host.warn()` for logging. Set `XR_DEBUG=1` to see debug output.

### Q: What about performance?

A: VM isolation adds ~5ms overhead per plugin load. Browser launch is ~50ms slower with sandbox enabled. MCP startup is ~10ms slower due to env filtering. These are acceptable trade-offs for security.

## Support

If you encounter issues during migration:

1. Check the [Security Architecture Document](./SECURITY.md)
2. Review the [Plugin Development Guide](./docs/plugins.md)
3. Open an issue on GitHub: https://github.com/ahmadrrrtx/xr/issues
4. Email: support@xr-project.org

---

**Remember**: Security is not a one-time fix. Always keep your plugins updated, audit regularly, and follow the principle of least privilege.
