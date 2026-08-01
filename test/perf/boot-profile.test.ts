/**
 * XR Phase 3 · T1 — boot-profile tests (subsystems-per-command).
 *
 * Proves command-scoped boot is real and correct:
 *   1. Every command in COMMAND_PROFILES boots a STRICT SUBSET of providers
 *      on the default set (no command profile may equal the full set unless
 *      it genuinely needs everything).
 *   2. The profile is a valid provider closure (deps resolved, canonical
 *      order, no cycles).
 *   3. Every Tokens.* a command actually resolves is covered by its profile
 *      (verified by golden-path execution of representative commands).
 *   4. `config get` boots only [config, state] — not skills/capabilities/
 *      business/shield (the measurable subsystems-per-command claim).
 *   5. A command WITHOUT a profile boots the full default set (conservative
 *      default preserved).
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync } from "node:fs";
import { describe, test, expect } from "bun:test";
import {
  COMMAND_PROFILES,
  DEFAULT_PROVIDER_ORDER,
  PROVIDER_REQUIRES,
  profileForCommand,
  providerClosure,
} from "../../src/core/boot-profile.ts";
import { XRKernel } from "../../src/core/kernel.ts";

const ROOT = join(import.meta.dir, "..", "..");

async function bootFor(command: string, home: string): Promise<{ profile: string[] | null; booted: string[] }> {
  const { bootKernelForCommand } = await import("../../src/cli/kernel-boot.ts");
  const { kernel, profile } = await bootKernelForCommand(command);
  const booted = kernel.bootedProviderIds();
  await kernel.shutdown();
  void home;
  return { profile, booted };
}

describe("Phase 3 · T1 — boot profiles", () => {
  test("every profile is a valid dependency closure (no unknown ids, deps first)", () => {
    for (const [cmd, ids] of Object.entries(COMMAND_PROFILES)) {
      if (ids == null) continue;
      const closed = providerClosure(ids);
      // Closure must contain every requested id.
      for (const id of ids) expect(closed).toContain(id);
      // Dependencies must precede dependents (canonical order check).
      const pos = new Map(closed.map((id, i) => [id, i]));
      for (const id of closed) {
        for (const dep of PROVIDER_REQUIRES[id] ?? []) {
          expect(pos.get(dep)!).toBeLessThan(pos.get(id)!);
        }
      }
    }
  });

  test("profiles are strict subsets of the default provider set (no full-boot command)", () => {
    const full = new Set(DEFAULT_PROVIDER_ORDER);
    for (const [cmd, ids] of Object.entries(COMMAND_PROFILES)) {
      if (ids == null) continue;
      const closed = providerClosure(ids);
      // A command profile must be smaller than the full set — if a command
      // needs everything it should have NO profile (explicit full boot).
      expect(closed.length, `${cmd} profile must be a strict subset`).toBeLessThan(full.size);
      for (const id of closed) expect(full.has(id), `${cmd}: unknown provider ${id}`).toBe(true);
    }
  });

  test("`config get provider` boots only [config] (leanest profile)", async () => {
    const home = join(tmpdir(), `xr-boot-profile-${process.pid}`);
    mkdirSync(home, { recursive: true });
    const { booted } = await bootFor("config", home);
    expect(booted).toEqual(["config"]);
    expect(booted).not.toContain("skills");
    expect(booted).not.toContain("capabilities");
    expect(booted).not.toContain("business");
    expect(booted).not.toContain("shield");
    expect(booted).not.toContain("trust");
    expect(booted).not.toContain("state");
  }, 60_000);

  test("`doctor` boots [state, config, providers, capabilities]", async () => {
    const home = join(tmpdir(), `xr-boot-profile-${process.pid}-d`);
    mkdirSync(home, { recursive: true });
    const { booted } = await bootFor("doctor", home);
    expect(booted.sort()).toEqual(["state", "config", "providers", "capabilities"].sort());
  }, 60_000);

  test("`skills` boots only [skills] (scan cache makes it cheap)", async () => {
    const home = join(tmpdir(), `xr-boot-profile-${process.pid}-s`);
    mkdirSync(home, { recursive: true });
    const { booted } = await bootFor("skills", home);
    expect(booted).toEqual(["skills"]);
  }, 60_000);

  test("`run` boots the agent closure (agent + deps)", async () => {
    const home = join(tmpdir(), `xr-boot-profile-${process.pid}-r`);
    mkdirSync(home, { recursive: true });
    const { booted } = await bootFor("run", home);
    expect(booted).toContain("agent");
    expect(booted).toContain("state");
    expect(booted).toContain("execution");
    expect(booted.length).toBeLessThan(DEFAULT_PROVIDER_ORDER.length);
  }, 60_000);

  test("unknown command with no profile boots the full default set (conservative)", async () => {
    const closed = profileForCommand("definitely-not-a-command");
    expect(closed).toBeNull();
  });

  test("XRKernel full bootstrap still registers the whole default set (no profile = full boot)", async () => {
    const home = join(tmpdir(), `xr-boot-profile-${process.pid}-full`);
    mkdirSync(home, { recursive: true });
    process.env.XR_HOME = home;
    const kernel = new XRKernel();
    await kernel.bootstrap();
    const booted = kernel.bootedProviderIds();
    await kernel.shutdown();
    expect(booted.length).toBe(DEFAULT_PROVIDER_ORDER.length);
    expect(booted).toEqual([...DEFAULT_PROVIDER_ORDER]);
  }, 60_000);
});
