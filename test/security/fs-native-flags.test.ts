import { expect, test } from "bun:test";
import { constants, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemAuthority } from "../../src/security/filesystem.ts";
import { anchoredOpen, fdClose, FD_FLAGS, linuxOpenFlags } from "../../src/security/fs-native.ts";

// FD_FLAGS are logical values, not host-native bits. Linux arm64 overrides
// O_DIRECTORY and O_NOFOLLOW in arch/arm64/include/uapi/asm/fcntl.h.
test("openat2 maps logical flags to the Linux x64 and arm64 ABIs", () => {
  const root = FD_FLAGS.PATH | FD_FLAGS.DIRECTORY;
  const create = 1 | FD_FLAGS.CREATE | FD_FLAGS.EXCLUSIVE | FD_FLAGS.NONBLOCK;
  expect(linuxOpenFlags(root, "x64")).toBe(0x2b0000);
  expect(linuxOpenFlags(root, "arm64")).toBe(0x28c000);
  expect(linuxOpenFlags(FD_FLAGS.PATH, "x64")).toBe(0x2a0000);
  expect(linuxOpenFlags(FD_FLAGS.PATH, "arm64")).toBe(0x288000);
  expect(linuxOpenFlags(create, "x64")).toBe(0xa08c1);
  expect(linuxOpenFlags(create, "arm64")).toBe(0x888c1);
  // On arm64 the x64 DIRECTORY and NOFOLLOW bits instead mean DIRECT and
  // LARGEFILE. Neither may leak into the native flags.
  expect(linuxOpenFlags(root, "arm64") & 0x30000).toBe(0);
  expect(() => linuxOpenFlags(root, "riscv64")).toThrow("filesystem unsupported");
});

const supportedLinux = process.platform === "linux" && ["x64", "arm64"].includes(process.arch);
test.skipIf(!supportedLinux)("encoded flags agree with the running Linux ABI", () => {
  const flags = linuxOpenFlags(FD_FLAGS.PATH | FD_FLAGS.DIRECTORY, process.arch);
  expect(flags & constants.O_DIRECTORY).toBe(constants.O_DIRECTORY);
  expect(flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
});

test.skipIf(!supportedLinux)("native openat2 allows confined I/O and refuses links and escapes", () => {
  const base = mkdtempSync(join(tmpdir(), "xr-linux-openat2-"));
  const root = join(base, "workspace"), outside = join(base, "outside");
  mkdirSync(root); mkdirSync(outside);
  writeFileSync(join(root, "ordinary.txt"), "inside");
  writeFileSync(join(outside, "canary.txt"), "outside");
  symlinkSync(outside, join(root, "link"), "dir");
  symlinkSync(join(outside, "canary.txt"), join(root, "link.txt"));
  let fs: FilesystemAuthority | undefined;
  try {
    fs = new FilesystemAuthority(root);
    expect(fs.read("ordinary.txt").content).toBe("inside");
    expect(fs.list().map(e => e.name)).toContain("ordinary.txt");
    const create = fs.prepare("created.txt", "write");
    try { create.commit("created"); } finally { create.close(); }
    expect(readFileSync(join(root, "created.txt"), "utf8")).toBe("created");
    for (const path of ["link/canary.txt", "link.txt", "../outside/canary.txt"]) {
      expect(() => fs!.read(path)).toThrow();
      expect(() => fs!.prepare(path, "write")).toThrow();
    }
    expect(readFileSync(join(outside, "canary.txt"), "utf8")).toBe("outside");
    const dir = anchoredOpen(-100, root, FD_FLAGS.PATH | FD_FLAGS.DIRECTORY, 0, true);
    try {
      // DIRECTORY must be honored by the kernel, not merely a logical bit.
      expect(() => anchoredOpen(dir, "ordinary.txt", FD_FLAGS.PATH | FD_FLAGS.DIRECTORY)).toThrow();
    } finally { fdClose(dir); }
  } finally {
    fs?.close();
    rmSync(base, { recursive: true, force: true });
  }
});
