/** Registry-backed adapter. A serialized grant is not an in-process capability. */
import { isAbsolute, relative, resolve, sep } from "node:path";
import { FilesystemAuthority, FilesystemError, type FilePurpose, type FilesystemLease } from "../../security/filesystem.ts";
import { AuthorityRegistry, validateGrant } from "./authority.ts";
export interface FilesystemGrantUse {
  grantId: string;
  actor: string;
  executionId: string;
  workspaceId: string;
  purpose: FilePurpose;
}
const contains = (root: string, path: string) => {
  const rel = relative(resolve(root), path);
  return !isAbsolute(rel) && rel.split(sep)[0] !== "..";
};
/** Only trusted host wiring calls this after its real approval/permission gate. */
export function filesystemFromGrant(registry: AuthorityRegistry, use: FilesystemGrantUse): FilesystemAuthority {
  const grant = registry.get(use.grantId), scope = grant?.fs.contentScope;
  if (!grant || !scope || scope.purpose !== use.purpose || grant.actor !== use.actor || !validateGrant(grant, use).valid) throw new FilesystemError();
  const current = () => registry.get(use.grantId) === grant && grant.actor === use.actor && validateGrant(grant, use).valid && grant.fs.contentScope === scope;
  const permits = (path: string, operation: "read" | "write" | "list") => {
    if (!current() || !scope.operations.includes(operation) || !contains(scope.root, path)) return false;
    // Explicit blocked paths are higher priority even than disclosure consent.
    if (grant.fs.blockedPaths.some(blocked => contains(blocked, path))) return false;
    const roots = operation === "write" ? grant.fs.writableRoots : [...grant.fs.writableRoots, ...grant.fs.readOnlyRoots];
    return roots.some(root => contains(root, path));
  };
  const lease: FilesystemLease = {
    grantId: grant.grantId, actor: use.actor, purpose: use.purpose,
    generation: `${grant.executionId}:${grant.issuedAt}:${grant.policyVersion}`,
    deniedPaths: [...grant.fs.blockedPaths], current,
    permits,
    permitsSensitiveRead(path, objectId) {
      return !!grant.approvalRef && permits(path, "read") && !!scope.sensitiveReads?.some(exact => exact.path === path && exact.objectId === objectId);
    },
  };
  const fs = new FilesystemAuthority(scope.root, use.purpose, lease);
  if (fs.root !== scope.root || fs.rootIdentity !== scope.rootIdentity) { fs.close(); throw new FilesystemError("stale"); }
  return fs;
}
