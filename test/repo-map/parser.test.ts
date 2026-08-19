import { describe, expect, test } from "bun:test";
import { parseSource } from "../../src/repo/parser/index.ts";

describe("Phase 11 — parser", () => {
  test("TypeScript: functions, classes, exports, imports", () => {
    const src = `
import { Foo } from "./foo.ts";
import type { Bar } from "../types.ts";
export class ToolRegistryService {
  register(name: string): void {}
}
export function createRegistry(): ToolRegistryService { return new ToolRegistryService(); }
export const VERSION = "1";
export interface Capability { id: string }
export type Mode = "agent" | "plan";
export enum Kind { Core }
`;
    const r = parseSource("src/tools/registry-service.ts", src);
    expect(r.confidence).toBe("structural");
    expect(r.imports.map((i) => i.specifier).sort()).toEqual(["../types.ts", "./foo.ts"]);
    const names = r.symbols.map((s) => s.name);
    expect(names).toContain("ToolRegistryService");
    expect(names).toContain("createRegistry");
    expect(names).toContain("VERSION");
    expect(names).toContain("Capability");
    expect(names).toContain("Mode");
    expect(names).toContain("Kind");
    expect(r.symbols.find((s) => s.name === "createRegistry")?.exported).toBe(true);
    expect(r.symbols.find((s) => s.name === "ToolRegistryService")?.kind).toBe("class");
    expect(r.symbols.find((s) => s.name === "register")?.kind).toBe("method");
  });

  test("Python: functions, classes, imports", () => {
    const src = `
import os
from pathlib import Path

class RepoMap:
    def rank(self):
        return 1

def build_map():
    return RepoMap()
`;
    const r = parseSource("aider/repomap.py", src);
    expect(r.confidence).toBe("structural");
    expect(r.imports.some((i) => i.specifier === "os" || i.specifier === "pathlib")).toBe(true);
    const names = r.symbols.map((s) => s.name);
    expect(names).toContain("RepoMap");
    expect(names).toContain("build_map");
    expect(names).toContain("rank");
  });

  test("Go and Rust scanners emit structural symbols", () => {
    const go = parseSource("main.go", `
package main
import "fmt"
func Hello() {}
type Server struct {}
`);
    expect(go.symbols.map((s) => s.name)).toContain("Hello");
    expect(go.imports.some((i) => i.specifier === "fmt")).toBe(true);

    const rs = parseSource("lib.rs", `
pub fn index() {}
pub struct Repo;
use std::fs;
`);
    expect(rs.symbols.map((s) => s.name)).toContain("index");
    expect(rs.symbols.map((s) => s.name)).toContain("Repo");
  });

  test("fallback is labeled heuristic, not structural", () => {
    const r = parseSource("Main.java", `import java.util.List;\npublic class Main {}`);
    expect(r.confidence).toBe("heuristic");
    expect(r.parser).toBe("xr-heuristic");
  });
});
