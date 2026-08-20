// 2.2.1.2.2 — deciding what a screen should show for the signed-in role.
//
// This is presentation only, and it matters to be exact about that: the
// authority on what a caller may do is the API's own middleware, which checks
// every single request against the permission matrix and cannot be bypassed.
// Hiding a button here changes nothing about what the server will accept. A
// person who forged their own permission list would see more controls and get
// the same 403s they get today.
//
// What this fixes is the honesty of the interface: until now a Viewer saw the
// identical edit, create and delete controls an administrator sees, and only
// found out by clicking one and reading an error.

export type PermissionAction = "read" | "create" | "update" | "delete";

// The modules the permission matrix actually covers (2.2.1.1.2's own list).
// Deliberately not every route in the application: the projects endpoints sit
// outside this list, requiring authentication but no module grant, so project
// screens must NOT gate themselves on a permission that doesn't exist. That
// gap is the specification's, not this module's, and is recorded in the
// Implementation Status Update rather than papered over here.
export const PERMISSIONED_MODULES = [
  "calendar", "wbs", "obs", "resource", "cost", "scheduling", "evm", "reporting", "planning",
] as const;

export type PermissionedModule = (typeof PERMISSIONED_MODULES)[number];

export interface PermissionHolder {
  is_platform_admin?: boolean;
  permissions?: string[] | null;
}

export function can(
  user: PermissionHolder | null | undefined,
  module: PermissionedModule,
  action: PermissionAction
): boolean {
  if (!user) return false;
  // A platform admin bypasses the permission check entirely on the server
  // (middleware.js does this before consulting any grant), so its own grant
  // list is legitimately empty — treating that as "can do nothing" would get
  // this exactly backwards.
  if (user.is_platform_admin) return true;
  const granted = user.permissions;
  if (!Array.isArray(granted)) return false;
  return granted.includes(`${module}:${action}`);
}

// True when the role can change anything at all in a module — the cheap check
// for whether a screen should show its editing affordances as a group, rather
// than testing three actions at every call site.
export function canModify(
  user: PermissionHolder | null | undefined,
  module: PermissionedModule
): boolean {
  return can(user, module, "create") || can(user, module, "update") || can(user, module, "delete");
}

// A short, human sentence for the banner a read-only screen shows, so the
// interface says why the controls are absent instead of leaving a person to
// wonder. Role names come from the database's own seeded role table.
export function readOnlyReason(roleName: string | null | undefined, moduleLabel: string): string {
  const role = (roleName ?? "").replace(/_/g, " ");
  return role
    ? `You have read-only access to ${moduleLabel} as ${role === "administrator" ? "an" : "a"} ${role}.`
    : `You have read-only access to ${moduleLabel}.`;
}
