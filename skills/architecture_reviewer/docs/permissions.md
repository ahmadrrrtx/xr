# Architecture Reviewer Permissions

Developer Skills may need filesystem reads, approved writes, and approved local validation commands.

## Declared permissions
- `fs:read`: Architecture Reviewer may need to inspect project files.
- `fs:write` **dangerous**: Architecture Reviewer may produce or edit project files only after approval.
- `shell` **dangerous**: Architecture Reviewer may run local validation commands only after approval.

## Approval policy
Dangerous permissions are declarations only. XR must still ask the user before side effects.
