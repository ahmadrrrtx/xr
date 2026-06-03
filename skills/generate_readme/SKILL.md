---
id: generate_readme
version: 1
source: preloaded
tools: [list_dir, read_file, write_file]
verifier: { kind: file_nonempty, path: "README.md" }
signed: false
---
# Generate README
1. `list_dir` + `read_file` package manifest & entry points.
2. Write a professional README: title, description, install, usage, license.
3. Success = README.md exists and is non-empty.
