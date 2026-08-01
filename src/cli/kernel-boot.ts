/**
 * XR Phase 3 · T1 — Command-scoped kernel boot.
 *
 * The ONLY place the CLI loads the kernel. The kernel module (and with it the
 * provider set and every service) is imported dynamically with a STATIC
 * literal path, so:
 *
 *   - fast paths (`--version`, `--help`, `shell`, `serve`) never load the
 *     kernel at all (Commandment 11: a command boots only what it needs);
 *   - command boots are profile-scoped (src/core/boot-profile.ts) — a
 *     `config get` boots [config] (+state), not skills/capabilities/business;
 *   - the dynamic import is compile-safe for `bun --compile` (Global Rule 7).
 */

import { profileForCommand } from "../core/boot-profile.ts";
import { bootTrace } from "../core/boot-trace.ts";

export interface BootedKernel {
  kernel: import("../core/kernel.ts").XRKernel;
  profile: string[] | null;
}

/**
 * Boot the kernel for a command. `command` is the registry name; its boot
 * profile is resolved here so the router stays profile-agnostic.
 */
export async function bootKernelForCommand(command: string): Promise<BootedKernel> {
  const profile = profileForCommand(command);

  bootTrace.mark("kernel-import");
  const { XRKernel } = await import("../core/kernel.ts"); // static literal — compile-safe
  bootTrace.mark("kernel-imported");

  const { installCommandLoaders } = await import("./command-loaders.ts"); // static literal
  const kernel = new XRKernel();
  installCommandLoaders(kernel.commands);

  await kernel.bootstrap({ profile });
  bootTrace.mark("bootstrapped");
  await kernel.start();
  bootTrace.mark("started");

  bootTrace.setProfile(profile, kernel.bootedProviderIds());
  return { kernel, profile };
}
