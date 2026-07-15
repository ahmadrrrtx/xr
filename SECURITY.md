# XR Security Architecture

## Overview

XR is designed as a secure AI Operating System. This document describes the security architecture, threat model, and implementation details for plugin isolation, browser sandboxing, and environment restriction.

## Critical Security Properties

### 1. Plugin Isolation (RCE Vector #1)

**Problem**: Plugins could bypass regex-based security scanning and execute arbitrary code on the host.

**Solution**: Multi-layer isolation with VM sandboxing as primary security boundary.

#### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    XR Host Process                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │          Plugin Loader (loader.ts)                   │  │
│  │  - Validates manifest                               │  │
│  │  - Computes file tree hashes                        │  │
│  │  - Static scanning (defense-in-depth)               │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                      │
│  ┌──────────────────▼───────────────────────────────────┐  │
│  │        VM Context (node:vm)                         │  │
│  │  - Separate V8 heap                                 │  │
│  │  - No access to Node.js built-ins                   │  │
│  │  - Frozen global object                             │  │
│  │  - Only safe primitives provided                    │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                      │
│  ┌──────────────────▼───────────────────────────────────┐  │
│  │        Plugin Code (Isolated)                        │  │
│  │  - No require() / import()                          │  │
│  │  - No process / fs / net                            │  │
│  │  - Only PluginHost API                              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

#### Implementation Details

**File: `src/plugins/loader.ts`**

1. **VM-based Isolation** (Primary Security Boundary)
   - Plugin code runs in `node:vm` context
   - Context has NO access to Node.js built-ins
   - Only explicitly provided globals are available
   - Context is frozen to prevent escape

2. **Static Scanning** (Defense-in-Depth)
   - Regex patterns improved with word boundaries
   - Scans for disallowed imports and patterns
   - NOT the primary security boundary (VM is)

3. **Hash Verification**
   - SHA-256 hash of entrypoint file
   - SHA-256 hash of entire file tree
   - Detects tampering with installed plugins

**Security Guarantees**:
- ✅ Plugin cannot access `require()` or `import()` to load host modules
- ✅ Plugin cannot access `process`, `fs`, `net`, or other sensitive APIs
- ✅ Plugin can only use capabilities explicitly granted via `PluginHost`
- ✅ All plugin actions are audited

### 2. Browser Sandbox (RCE Vector #2)

**Problem**: Playwright browser launched with `--no-sandbox --disable-setuid-sandbox`, allowing renderer process escapes.

**Solution**: Remove dangerous flags, add explicit opt-in for development only.

#### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Playwright Browser                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │     Chrome/Chromium (Sandboxed by default)           │  │
│  │  - Sandbox enabled (--enable-sandbox)               │  │
│  │  - No --no-sandbox                                   │  │
│  │  - No --disable-setuid-sandbox                       │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                      │
│  ┌──────────────────▼───────────────────────────────────┐  │
│  │     Browser Context (Isolated)                       │  │
│  │  - Isolated cookies/storage                          │  │
│  │  - No geolocation                                    │  │
│  │  - Request interception (optional)                   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

#### Implementation Details

**File: `src/control/browser.ts`**

1. **Sandbox Enabled by Default**
   ```typescript
   // PRODUCTION SECURITY: Ensure sandbox is enabled
   const sandboxArgs = args.filter(arg => 
     arg !== "--no-sandbox" && 
     arg !== "--disable-setuid-sandbox"
   );
   sandboxArgs.push("--enable-sandbox");
   ```

2. **Explicit Opt-in to Disable Sandbox**
   ```typescript
   const unsafeMode = process.env.XR_BROWSER_UNSAFE === "1";
   if (unsafeMode) {
     // WARNING: Only for development
     console.warn("WARNING: Browser sandbox is DISABLED");
     args.push("--no-sandbox");
   }
   ```

3. **Additional Security Measures**
   - Disable GPU to prevent GPU process escapes
   - Disable background networking
   - Disable sync and extensions
   - Validate all URLs (http/https only)
   - Limit screenshot paths to prevent traversal

**Security Guarantees**:
- ✅ Browser sandbox is ENABLED by default
- ✅ `--no-sandbox` only possible with explicit `XR_BROWSER_UNSAFE=1`
- ✅ All browser actions are logged and approval-gated
- ✅ URL validation prevents `file://`, `chrome://` access

### 3. MCP Environment Isolation

**Problem**: MCP servers inherit full `process.env`, including secrets and API keys.

**Solution**: Allow-list based environment variable filtering.

#### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   XR Host Process                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │      MCP Client (client.ts)                          │  │
│  │  - Creates allow-listed environment                  │  │
│  │  - Passes only safe variables                        │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                      │
│  ┌──────────────────▼───────────────────────────────────┐  │
│  │      Child Process (MCP Server)                     │  │
│  │  env = {                                             │  │
│  │    PATH: "...",                                      │  │
│  │    XR_DEBUG: "...",                                  │  │
│  │    MCP_* : "...",                                     │  │
│  │    // NOT process.env                                 │  │
│  │  }                                                   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

#### Implementation Details

**File: `src/mcp/client.ts`**

1. **Environment Allow-list**
   ```typescript
   function createAllowedEnvironment(
     customEnv?: Record<string, string>
   ): Record<string, string> {
     const allowed: Record<string, string> = {};
     
     // Only pass through explicitly allowed variables
     for (const [key, value] of Object.entries(process.env)) {
       if (value !== undefined && isEnvAllowed(key)) {
         allowed[key] = value;
       }
     }
     
     return allowed;
   }
   ```

2. **Allowed Prefixes**
   - `NODE_ENV`
   - `XR_*`
   - `MCP_*`
   - `PLUGIN_*`
   - `PATH`, `HOME`, `USER`, `SHELL`, `LANG`, `LC_ALL`, `TERM`

3. **Input Validation**
   - Command validation (no `..`, `|`)
   - URL validation (http/https only)
   - Tool name validation (alphanumeric + `._-`)
   - URI validation (prevent injection)

**Security Guarantees**:
- ✅ MCP servers cannot access `process.env` secrets
- ✅ Only explicitly allowed environment variables are passed
- ✅ All inputs are validated and sanitized
- ✅ Child processes run with `shell: false`

## Threat Model

### Threats Mitigated

| Threat | Mitigation | Layer |
|--------|------------|-------|
| Plugin RCE via `require("child_process")` | VM isolation + no access to require | Primary |
| Plugin RCE via `process.env` access | VM isolation + static scan | Primary + Defense-in-depth |
| Plugin escape via `eval()` / `new Function()` | VM isolation + static scan | Primary + Defense-in-depth |
| Browser escape via `--no-sandbox` | Sandbox always enabled (unless opted-in) | Primary |
| Browser escape via malicious page | Sandbox + isolated context | Primary |
| MCP secret leakage via `process.env` | Allow-list environment | Primary |
| MCP RCE via command injection | Command validation + shell:false | Primary |
| File traversal via plugin `fs` | `safeJoin()` with normalization | Primary |
| Prototype pollution via MCP args | `sanitizeObject()` | Primary |

### Threats NOT Mitigated (Future Work)

| Threat | Priority | Plan |
|--------|----------|------|
| V8 engine escape from VM | High | Use separate process (Docker/MicroVM) |
| Timing side-channels | Medium | Implement in future release |
| DNS rebinding | Medium | Implement in future release |
| Browser 0-day | Low | Keep Playwright updated |

## Security Best Practices for Plugin Developers

### 1. Declare Minimal Permissions

```json
{
  "permissions": ["fs:read", "net"],  // Only what you need
  "grantedPermissions": ["fs:read"]    // User can further restrict
}
```

### 2. Use PluginHost API (Never Direct Access)

```typescript
// ✅ GOOD: Use host API
const content = host.fs?.read("data.txt");
const response = await host.net?.fetch("https://api.example.com");

// ❌ BAD: Don't try to bypass
// require("fs").readFileSync(...);  // Blocked by VM
// process.env.API_KEY;              // Blocked by VM
```

### 3. Handle Errors Gracefully

```typescript
export async function activate(host: PluginHost) {
  return {
    tools: [{
      name: "my-tool",
      run: async (args) => {
        try {
          // Your logic here
          return { ok: true, output: "Success" };
        } catch (err) {
          host.warn(`Error: ${(err as Error).message}`);
          return { ok: false, output: (err as Error).message };
        }
      }
    }]
  };
}
```

## Security Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `XR_BROWSER_UNSAFE` | `0` | Set to `1` to disable browser sandbox (DEV ONLY) |
| `XR_BROWSER_HEADLESS` | `0` | Set to `1` to run browser headless |
| `XR_BROWSER_BLOCK_LOCALHOST` | `0` | Set to `1` to block localhost access |
| `XR_DEBUG` | `0` | Set to `1` to enable debug logging |
| `XR_PLUGIN_TIMEOUT` | `5000` | Plugin VM execution timeout (ms) |

### Config File

```toml
[security]
egressAllowlist = ["https://api.example.com", "https://*.github.com"]
pluginTimeout = 5000
browserSandbox = true  # Always true unless XR_BROWSER_UNSAFE=1
mcpEnvAllowlist = ["NODE_ENV", "XR_*", "MCP_*"]
```

## Security Audit Checklist

When reviewing plugin code:

- [ ] No `require()` or `import()` statements for disallowed modules
- [ ] No `process.env` access
- [ ] No `eval()` or `new Function()`
- [ ] No direct `fetch()` (use `host.net.fetch`)
- [ ] File paths use `host.fs.path()` (no direct path construction)
- [ ] All user inputs are validated
- [ ] Error messages don't leak sensitive info
- [ ] Permissions are minimal

When reviewing browser code:

- [ ] No `--no-sandbox` or `--disable-setuid-sandbox` in production
- [ ] All URLs are validated
- [ ] Screenshot paths are sanitized
- [ ] Browser actions are approval-gated

When reviewing MCP code:

- [ ] Environment variables are allow-listed
- [ ] Child processes use `shell: false`
- [ ] Commands are validated
- [ ] URLs are validated (http/https only)

## Reporting Security Issues

Please report security vulnerabilities to: security@xr-project.org

We follow responsible disclosure:
1. Report the issue privately
2. We confirm and triage within 48 hours
3. We develop and test a fix
4. We release the fix and notify users
5. We publicly disclose after fix is deployed

## Security Updates

- **2026-07-15**: Initial security architecture (Phase 1-3 complete)
  - VM-based plugin isolation
  - Browser sandbox enabled by default
  - MCP environment allow-listing

- **Future**: Process-based isolation (Docker/MicroVM)
- **Future**: Network policy engine
- **Future**: Secret management system

## References

- [Deno Security Model](https://docs.deno.com/runtime/fundamentals/security/)
- [OpenHands Security Architecture](https://arxiv.org/html/2407.16741v3)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Chrome Sandbox](https://chromium.googlesource.com/chromium/src/+/main/docs/design/sandbox.md)

---

**This security architecture is a living document. Updates will be made as the threat landscape evolves.**
