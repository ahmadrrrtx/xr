---
id: write_tests
version: 1
source: preloaded
tools: [read_file, write_file]
verifier: { kind: file_exists, path: "" }
signed: false
---
# Write Tests
1. `read_file` the target source file.
2. Identify public functions and edge cases.
3. Generate tests (jest/pytest as appropriate) and write to the test path.
4. Success = the new test file exists.
