# Docker Expert Permissions

Developer Skills may need filesystem reads, approved writes, and approved local validation commands.

## Declared permissions
- `fs:read`: Docker Expert may need to inspect project files.
- `fs:write` **dangerous**: Docker Expert may produce or edit project files only after approval.
- `shell` **dangerous**: Docker Expert may run local validation commands only after approval.

## Approval policy
Dangerous permissions are declarations only. XR must still ask the user before side effects.
