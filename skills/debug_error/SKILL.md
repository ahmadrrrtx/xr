---
id: debug_error
version: 1
source: preloaded
tools: [read_file, list_dir, web_search]
verifier: user_approved
signed: false
---
# Debug Error
1. Read the stack trace / error message provided.
2. `list_dir` and `read_file` the implicated files.
3. Identify the root cause; if unfamiliar, `web_search` the exact error.
4. Propose a fix as a diff (write_file is approval-gated in agent mode).
