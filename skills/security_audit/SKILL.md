---
id: security_audit
version: 1
source: preloaded
tools: [list_dir, read_file]
verifier: user_approved
signed: false
---
# Security Audit
1. Scan source for OWASP-style issues: injection, secrets in code,
   unsafe shell, weak crypto, missing input validation.
2. Report findings ranked by severity with file:line references.
