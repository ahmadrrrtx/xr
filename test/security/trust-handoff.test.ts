import { describe, it, expect } from "bun:test";
import {
  classifySensitiveWrite,
  requiresTrustHandoffApproval,
  TRUST_HANDOFF_RULES,
} from "../../src/security/trust-handoff.ts";

describe("Phase 07 · trust-handoff classification", () => {
  it("classifies .git/config as TRUST-HANDOFF", () => {
    const v = classifySensitiveWrite(".git/config");
    expect(v.classification).toBe("TRUST-HANDOFF");
    expect(v.requiresApproval).toBe(true);
    expect(v.trustedComponent).toContain("Git");
    expect(v.executionImplication).toMatch(/arbitrary|command/i);
  });

  it("classifies nested .git/config", () => {
    expect(classifySensitiveWrite("sub/repo/.git/config").classification).toBe("TRUST-HANDOFF");
  });

  it("classifies .git/hooks/* as TRUST-HANDOFF", () => {
    const v = classifySensitiveWrite(".git/hooks/pre-commit");
    expect(v.classification).toBe("TRUST-HANDOFF");
    expect(v.requiresApproval).toBe(true);
  });

  it("classifies .claude/settings.local.json and settings.json", () => {
    expect(classifySensitiveWrite(".claude/settings.local.json").classification).toBe("TRUST-HANDOFF");
    expect(classifySensitiveWrite(".claude/settings.json").classification).toBe("TRUST-HANDOFF");
  });

  it("classifies .vscode/tasks.json and settings.json as TRUST-HANDOFF", () => {
    expect(classifySensitiveWrite(".vscode/tasks.json").classification).toBe("TRUST-HANDOFF");
    expect(classifySensitiveWrite(".vscode/settings.json").classification).toBe("TRUST-HANDOFF");
  });

  it("classifies *.code-workspace as TRUST-HANDOFF", () => {
    expect(classifySensitiveWrite("team.code-workspace").classification).toBe("TRUST-HANDOFF");
  });

  it("classifies package.json as EXECUTABLE-CONFIG", () => {
    const v = classifySensitiveWrite("package.json");
    expect(v.classification).toBe("EXECUTABLE-CONFIG");
    expect(v.requiresApproval).toBe(true);
    expect(v.trustedComponent).toMatch(/npm|yarn|pnpm/i);
  });

  it("classifies Makefile / Dockerfile / CI as EXECUTABLE-CONFIG", () => {
    expect(classifySensitiveWrite("Makefile").classification).toBe("EXECUTABLE-CONFIG");
    expect(classifySensitiveWrite("Dockerfile").classification).toBe("EXECUTABLE-CONFIG");
    expect(classifySensitiveWrite(".github/workflows/ci.yml").classification).toBe("EXECUTABLE-CONFIG");
    expect(classifySensitiveWrite("docker-compose.yml").classification).toBe("EXECUTABLE-CONFIG");
  });

  it("classifies .env as REQUIRES-APPROVAL (secret exposure)", () => {
    const v = classifySensitiveWrite(".env");
    expect(v.classification).toBe("REQUIRES-APPROVAL");
    expect(v.requiresApproval).toBe(true);
  });

  it("classifies shell rc files as TRUST-HANDOFF", () => {
    expect(classifySensitiveWrite(".bashrc").classification).toBe("TRUST-HANDOFF");
    expect(classifySensitiveWrite(".zshrc").classification).toBe("TRUST-HANDOFF");
    expect(classifySensitiveWrite(".profile").classification).toBe("TRUST-HANDOFF");
  });

  it("does NOT over-block ordinary source/docs/config files", () => {
    expect(classifySensitiveWrite("src/index.ts").classification).toBe("SAFE");
    expect(classifySensitiveWrite("README.md").classification).toBe("SAFE");
    expect(classifySensitiveWrite("docs/security/SSRF_DEFENSE.md").classification).toBe("SAFE");
    expect(classifySensitiveWrite("tsconfig.json").classification).toBe("SAFE");
    expect(requiresTrustHandoffApproval("src/app.ts")).toBe(false);
  });

  it("is case-insensitive on extensions/basenames", () => {
    expect(classifySensitiveWrite(".ENV").classification).toBe("REQUIRES-APPROVAL");
    expect(classifySensitiveWrite("DOCKERFILE").classification).toBe("EXECUTABLE-CONFIG");
    expect(classifySensitiveWrite(".GIT/CONFIG").classification).toBe("TRUST-HANDOFF");
  });

  it("reduces an absolute workspace path to relative before matching", () => {
    const v = classifySensitiveWrite("/home/user/project/.git/config", "/home/user/project");
    expect(v.classification).toBe("TRUST-HANDOFF");
    expect(v.requiresApproval).toBe(true);
  });

  it("aggregates via requiresTrustHandoffApproval", () => {
    expect(requiresTrustHandoffApproval(".git/config")).toBe(true);
    expect(requiresTrustHandoffApproval("src/app.ts")).toBe(false);
  });

  it("rule set covers the spec's required sensitive paths", () => {
    const ids = TRUST_HANDOFF_RULES.map((r) => r.id);
    for (const id of [
      "git.config",
      "git.hooks",
      "claude.settings.local",
      "vscode.tasks",
      "code-workspace",
      "package.json",
    ]) {
      expect(ids).toContain(id);
    }
  });
});
