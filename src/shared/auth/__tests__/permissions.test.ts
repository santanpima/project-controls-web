import { describe, it, expect } from "vitest";
import { can, canModify, readOnlyReason } from "../permissions";

// The grant lists below are the real ones, read from the seeded permission
// matrix in the database rather than invented for the test: a viewer holds
// read across every module, a scheduler can change WBS and scheduling but only
// read OBS, and a project manager holds everything.
const viewer = { is_platform_admin: false, permissions: ["wbs:read", "obs:read", "calendar:read"] };
const scheduler = {
  is_platform_admin: false,
  permissions: [
    "wbs:read", "wbs:create", "wbs:update", "wbs:delete",
    "obs:read",
    "scheduling:read", "scheduling:create", "scheduling:update", "scheduling:delete",
  ],
};
const platformAdmin = { is_platform_admin: true, permissions: [] };

describe("can", () => {
  it("grants what the role actually holds", () => {
    expect(can(viewer, "wbs", "read")).toBe(true);
    expect(can(scheduler, "wbs", "update")).toBe(true);
  });

  it("refuses what it doesn't", () => {
    expect(can(viewer, "wbs", "update")).toBe(false);
    expect(can(viewer, "obs", "delete")).toBe(false);
  });

  it("distinguishes between modules for the same role", () => {
    // The real asymmetry worth catching: a scheduler edits WBS but only reads
    // OBS. A check that ignored the module would get this wrong.
    expect(can(scheduler, "wbs", "delete")).toBe(true);
    expect(can(scheduler, "obs", "delete")).toBe(false);
  });

  it("treats a platform admin as able to do anything, despite an empty grant list", () => {
    // The server bypasses the matrix entirely for a platform admin, so its
    // list is legitimately empty — reading that as "no access" would invert
    // the most privileged account in the system.
    expect(can(platformAdmin, "wbs", "delete")).toBe(true);
    expect(can(platformAdmin, "reporting", "create")).toBe(true);
  });

  it("refuses everything for a signed-out or unknown user", () => {
    expect(can(null, "wbs", "read")).toBe(false);
    expect(can(undefined, "wbs", "read")).toBe(false);
  });

  it("refuses everything when the permission list is missing entirely", () => {
    // An older token or a backend that predates this field must fail closed,
    // not open.
    expect(can({ is_platform_admin: false }, "wbs", "read")).toBe(false);
    expect(can({ is_platform_admin: false, permissions: null }, "wbs", "read")).toBe(false);
  });

  it("doesn't match a different action with the same prefix", () => {
    expect(can({ permissions: ["wbs:readonly"] }, "wbs", "read")).toBe(false);
  });
});

describe("canModify", () => {
  it("is false for a read-only role", () => {
    expect(canModify(viewer, "wbs")).toBe(false);
  });

  it("is true when any one of create, update or delete is held", () => {
    expect(canModify(scheduler, "wbs")).toBe(true);
    expect(canModify({ permissions: ["obs:update"] }, "obs")).toBe(true);
  });

  it("is false for a module the role can only read", () => {
    expect(canModify(scheduler, "obs")).toBe(false);
  });
});

describe("readOnlyReason", () => {
  it("names the role in plain words", () => {
    expect(readOnlyReason("project_manager", "the WBS")).toBe(
      "You have read-only access to the WBS as a project manager."
    );
  });

  it("uses the right article for administrator", () => {
    expect(readOnlyReason("administrator", "the OBS")).toContain("as an administrator");
  });

  it("still says something useful with no role at all", () => {
    expect(readOnlyReason(null, "the WBS")).toBe("You have read-only access to the WBS.");
  });
});
