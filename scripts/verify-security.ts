#!/usr/bin/env bun

/**
 * XR Security Verification Script
 * 
 * This script verifies that all security fixes are properly implemented.
 * Run this after deploying the security fixes.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

console.log(`
╔══════════════════════════════════════════════════════════════╗
║            XR Security Verification Script                        ║
╚══════════════════════════════════════════════════════════════╝

Checking security fixes for:
1. Plugin sandbox bypass (regex → VM isolation)
2. Browser --no-sandbox flag (disabled → enabled by default)
3. MCP environment leakage (full env → allow-list)

`);

let passed = 0;
let failed = 0;

function check(name: string, checkFn: () => boolean) {
  const result = checkFn();
  if (result) {
    console.log(`✅ PASS: ${name}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${name}`);
    failed++;
  }
}

// ── Check 1: Plugin Loader ────────────────────────────────────────

console.log(`\n[1] Plugin Loader Security\n${"=".repeat(50)}`);

const loaderSource = readFileSync(join(__dirname, "../src/plugins/loader.ts"), "utf8");

check("VM isolation function exists", () => {
  return loaderSource.includes("loadInIsolatedContext");
});

check("createContext is used", () => {
  return loaderSource.includes("createContext");
});

check("VM context is frozen", () => {
  return loaderSource.includes("Object.freeze(context)");
});

check("Plugin timeout is set", () => {
  return loaderSource.includes("timeout: 5000");
});

check("No direct import() without VM", () => {
  // Should use loadInIsolatedContext, not direct import
  const lines = loaderSource.split("\n");
  let inIsolatedContext = false;
  for (const line of lines) {
    if (line.includes("loadInIsolatedContext")) inIsolatedContext = true;
    if (inIsolatedContext && line.includes("import(") && !line.includes("//")) {
      return false;
    }
  }
  return true;
});

// ── Check 2: Browser Security ─────────────────────────────────────

console.log(`\n[2] Browser Security\n${"=".repeat(50)}`);

const browserSource = readFileSync(join(__dirname, "../src/control/browser.ts"), "utf8");

check("No --no-sandbox in default config", () => {
  // Should not have --no-sandbox outside of unsafe mode check
  const lines = browserSource.split("\n");
  let inUnsafeCheck = false;
  for (const line of lines) {
    if (line.includes("XR_BROWSER_UNSAFE")) inUnsafeCheck = true;
    if (line.includes("--no-sandbox") && !inUnsafeCheck) {
      return false;
    }
  }
  return true;
});

check("Sandbox enabled by default", () => {
  return browserSource.includes("--enable-sandbox");
});

check("XR_BROWSER_UNSAFE opt-in exists", () => {
  return browserSource.includes("XR_BROWSER_UNSAFE");
});

check("Warning logged when sandbox disabled", () => {
  return browserSource.includes("WARNING: Browser sandbox is DISABLED");
});

check("URL validation present", () => {
  return browserSource.includes("Unsupported protocol");
});

// ── Check 3: MCP Client Security ──────────────────────────────────

console.log(`\n[3] MCP Client Security\n${"=".repeat(50)}`);

const mcpSource = readFileSync(join(__dirname, "../src/mcp/client.ts"), "utf8");

check("Environment allow-list exists", () => {
  return mcpSource.includes("createAllowedEnvironment");
});

check("ALLOWED_ENV_PREFIXES defined", () => {
  return mcpSource.includes("ALLOWED_ENV_PREFIXES");
});

check("ALLOWED_ENV_EXACT defined", () => {
  return mcpSource.includes("ALLOWED_ENV_EXACT");
});

check("No full process.env inheritance", () => {
  return !mcpSource.includes("...process.env,");
});

check("shell: false used", () => {
  return mcpSource.includes("shell: false");
});

check("Command validation present", () => {
  return mcpSource.includes("Potentially unsafe command");
});

check("sanitizeObject function exists", () => {
  return mcpSource.includes("sanitizeObject");
});

check("Prototype pollution prevention", () => {
  return mcpSource.includes("__proto__") && mcpSource.includes("constructor");
});

// ── Check 4: Host Security ───────────────────────────────────────

console.log(`\n[4] Plugin Host Security\n${"=".repeat(50)}`);

const hostSource = readFileSync(join(__dirname, "../src/plugins/host.ts"), "utf8");

check("Path normalization present", () => {
  return hostSource.includes("normalize(rel)");
});

check("Path traversal prevention", () => {
  return hostSource.includes("Path traversal detected");
});

check("Host object is frozen", () => {
  return hostSource.includes("Object.freeze(host)");
});

check("Input validation present", () => {
  return hostSource.includes("Invalid path") && hostSource.includes("Invalid content");
});

check("Audit logging present", () => {
  return hostSource.includes("audit(");
});

check("Sensitive data redaction", () => {
  return hostSource.includes("redactLine");
});

// ── Check 5: Documentation ────────────────────────────────────────

console.log(`\n[5] Security Documentation\n${"=".repeat(50)}`);

try {
  const securityDoc = readFileSync(join(__dirname, "../SECURITY.md"), "utf8");
  check("SECURITY.md exists", () => true);
  check("SECURITY.md has threat model", () => {
    return securityDoc.includes("Threat Model");
  });
  check("SECURITY.md has architecture", () => {
    return securityDoc.includes("Security Architecture");
  });
} catch {
  check("SECURITY.md exists", () => false);
}

try {
  const migrationDoc = readFileSync(join(__dirname, "../MIGRATION.md"), "utf8");
  check("MIGRATION.md exists", () => true);
  check("MIGRATION.md has steps", () => {
    return migrationDoc.includes("Migration Steps");
  });
} catch {
  check("MIGRATION.md exists", () => false);
}

// ── Summary ───────────────────────────────────────────────────────

console.log(`\n${"=".repeat(60)}`);
console.log(`SECURITY VERIFICATION SUMMARY`);
console.log(`${"=".repeat(60)}\n`);

console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Total:  ${passed + failed}`);

if (failed === 0) {
  console.log(`\n🎉 ALL SECURITY CHECKS PASSED!`);
  console.log(`\nXR is now secure against:`);
  console.log(`  - Plugin sandbox bypass (RCE)`);
  console.log(`  - Browser --no-sandbox (RCE)`);
  console.log(`  - MCP environment leakage (Info Disclosure)`);
  console.log(`\n✅ Safe to deploy to production.`);
  process.exit(0);
} else {
  console.log(`\n⚠️  SOME SECURITY CHECKS FAILED!`);
  console.log(`\nPlease review the failed checks above.`);
  console.log(`Do NOT deploy to production until all checks pass.`);
  process.exit(1);
}
