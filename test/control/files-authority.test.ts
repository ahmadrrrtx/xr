/** A1 F03: desktop control file actions must use the filesystem authority (root-bound, sensitive-denied). */
import { beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = mkdtempSync(join(tmpdir(), "a1-control-"));
const root = join(base, "root");
const outside = join(base, "outside");
mkdirSync(root); mkdirSync(outside);
writeFileSync(join(outside, "secret.txt"), "OUTSIDE_CANARY_CONTROL");
writeFileSync(join(root, "ok.txt"), "INSIDE_OK");
writeFileSync(join(root, ".env"), "SECRET_CANARY_ENV=1");
symlinkSync(outside, join(root, "link"), "dir");

let files: typeof import("../../src/control/files.ts");
beforeAll(async () => {
  process.env.XR_FILES_ROOT = root;
  files = await import("../../src/control/files.ts");
});

test("F03 control read: positive in-root read works", async () => {
  const r = await files.fileRead("ok.txt");
  expect(r.ok).toBe(true);
  expect(JSON.stringify(r.data)).toContain("INSIDE_OK");
});

test("F03 control read: outside-root absolute path is denied before content is returned", async () => {
  const r = await files.fileRead(join(outside, "secret.txt"));
  expect(r.ok).toBe(false);
  expect(JSON.stringify(r)).not.toContain("OUTSIDE_CANARY_CONTROL");
});

test("F03 control read: sensitive in-root path is denied", async () => {
  const r = await files.fileRead(".env");
  expect(r.ok).toBe(false);
  expect(JSON.stringify(r)).not.toContain("SECRET_CANARY_ENV");
});

test("F03 control read: ancestor symlink escaping root is denied", async () => {
  const r = await files.fileRead("link/secret.txt");
  expect(r.ok).toBe(false);
  expect(JSON.stringify(r)).not.toContain("OUTSIDE_CANARY_CONTROL");
});

test("F03 control write: outside-root write is denied and leaves outside file unchanged", async () => {
  const r = await files.fileWrite(join(outside, "secret.txt"), "OVERWRITTEN");
  expect(r.ok).toBe(false);
  expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("OUTSIDE_CANARY_CONTROL");
});

test("F03 control write: write through escaping symlink is denied", async () => {
  const r = await files.fileWrite("link/new.txt", "ESCAPED");
  expect(r.ok).toBe(false);
  expect(existsSync(join(outside, "new.txt"))).toBe(false);
});

test("F03 control list: outside-root directory is denied", async () => {
  const r = await files.fileList(outside);
  expect(r.ok).toBe(false);
  expect(JSON.stringify(r)).not.toContain("secret.txt");
});

test("F03 control delete: outside-root delete is denied and file survives", async () => {
  const r = await files.fileDelete(join(outside, "secret.txt"));
  expect(r.ok).toBe(false);
  expect(existsSync(join(outside, "secret.txt"))).toBe(true);
});

test("F03 control positive: in-root write, mkdir, list, delete succeed", async () => {
  expect((await files.fileMkdir("sub")).ok).toBe(true);
  expect((await files.fileWrite("sub/new.txt", "NEW_OK")).ok).toBe(true);
  expect(readFileSync(join(root, "sub", "new.txt"), "utf8")).toBe("NEW_OK");
  const listed = await files.fileList("sub");
  expect(JSON.stringify(listed.data)).toContain("new.txt");
  expect((await files.fileDelete("sub/new.txt")).ok).toBe(true);
  expect(existsSync(join(root, "sub", "new.txt"))).toBe(false);
});
