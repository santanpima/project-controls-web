import { describe, it, expect } from "vitest";
import {
  buildTree, flattenVisible, idsWithChildren, ancestorIds, descendantIds, validMoveTargets,
  compareDottedCodes,
} from "../hierarchy";
import type { HierarchyAccessors } from "../hierarchy";

// Exercised here with OBS-shaped rows specifically. The WBS suite already
// covers the same functions through wbs-tree's own accessors, so between the
// two, this module is tested against both field-naming conventions that
// actually use it — which is the point of having lifted it out of the WBS
// screen in the first place.
interface Org {
  org_id: string;
  parent_obs_id: string | null;
  org_code: string;
  name: string;
}

const org = (id: string, parent: string | null, code: string, name: string): Org => ({
  org_id: id, parent_obs_id: parent, org_code: code, name,
});

const accessors: HierarchyAccessors<Org> = {
  getId: (o) => o.org_id,
  getParentId: (o) => o.parent_obs_id,
  compare: (a, b) => a.org_code.localeCompare(b.org_code),
};

//  ENG      Engineering
//    ENG-SW   Software
//    ENG-HW   Hardware
//  SUB      Acme Subcontracting
const orgs: Org[] = [
  org("1", null, "ENG", "Engineering"),
  org("2", "1", "ENG-SW", "Software"),
  org("3", "1", "ENG-HW", "Hardware"),
  org("4", null, "SUB", "Acme Subcontracting"),
];

const codes = (rows: { element: Org }[]) => rows.map((r) => r.element.org_code);

describe("buildTree with OBS accessors", () => {
  it("nests sub-organizations under their parent", () => {
    const roots = buildTree(orgs, accessors);
    expect(roots.map((r) => r.element.org_code)).toEqual(["ENG", "SUB"]);
    expect(roots[0].children.map((c) => c.element.org_code)).toEqual(["ENG-HW", "ENG-SW"]);
  });

  it("sorts siblings by org code, which for OBS is plain string order", () => {
    // ENG-HW before ENG-SW alphabetically — organization codes are free-form
    // identifiers, not the dotted numbers WBS generates.
    const roots = buildTree(orgs, accessors);
    expect(roots[0].children.map((c) => c.element.org_code)).toEqual(["ENG-HW", "ENG-SW"]);
  });

  it("preserves input order when no comparison is supplied", () => {
    const unsorted = buildTree(orgs, { getId: accessors.getId, getParentId: accessors.getParentId });
    expect(unsorted[0].children.map((c) => c.element.org_code)).toEqual(["ENG-SW", "ENG-HW"]);
  });

  it("promotes an organization whose parent is missing to a root", () => {
    const roots = buildTree([org("9", "gone", "ORPH", "Orphaned")], accessors);
    expect(roots.map((r) => r.element.org_code)).toEqual(["ORPH"]);
  });
});

describe("flattenVisible with OBS accessors", () => {
  it("hides sub-organizations under a collapsed parent", () => {
    expect(codes(flattenVisible(buildTree(orgs, accessors), new Set(), accessors))).toEqual(["ENG", "SUB"]);
  });

  it("reveals them when expanded, with depth from tree position", () => {
    const rows = flattenVisible(buildTree(orgs, accessors), new Set(["1"]), accessors);
    expect(codes(rows)).toEqual(["ENG", "ENG-HW", "ENG-SW", "SUB"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 0]);
  });
});

describe("structural helpers with OBS accessors", () => {
  it("idsWithChildren finds the organizations that have sub-organizations", () => {
    expect([...idsWithChildren(orgs, accessors)]).toEqual(["1"]);
  });

  it("ancestorIds walks up from a sub-organization", () => {
    expect(ancestorIds(orgs, "2", accessors)).toEqual(["1"]);
  });

  it("descendantIds collects a whole division", () => {
    expect([...descendantIds(orgs, "1", accessors)].sort()).toEqual(["2", "3"]);
  });

  it("validMoveTargets refuses a move under the organization's own sub-org", () => {
    // Reparenting Engineering under Software is the cycle the V6 trigger
    // refuses; it should never be offered on the form in the first place.
    const targets = validMoveTargets(orgs, "1", accessors).map((o) => o.org_code);
    expect(targets).not.toContain("ENG");
    expect(targets).not.toContain("ENG-SW");
    expect(targets).toEqual(["SUB"]);
  });

  it("validMoveTargets excludes the current parent, since that isn't a move", () => {
    expect(validMoveTargets(orgs, "2", accessors).map((o) => o.org_code)).not.toContain("ENG");
  });
});

describe("compareDottedCodes", () => {
  it("orders dotted numeric codes numerically, segment by segment", () => {
    expect(["1.10", "1.2", "2.1", "1.1"].sort(compareDottedCodes)).toEqual(["1.1", "1.2", "1.10", "2.1"]);
  });
});
