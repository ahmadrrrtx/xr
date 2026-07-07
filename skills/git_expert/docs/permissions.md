# Git Expert Permissions

Developer Skills may need filesystem reads, approved writes, and approved local validation commands.

## Declared permissions
- `fs:read`: Git Expert may need to inspect project files.
- `fs:write` **dangerous**: Git Expert may produce or edit project files only after approval.
- `shell` **dangerous**: Git Expert may run local validation commands only after approval.

## Approval policy
Dangerous permissions are declarations only. XR must still ask the user before side effects.
