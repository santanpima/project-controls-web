import { describe, it, expect } from "vitest";
import {
  buildResourceTree, flattenResourceTree, expandableKeys, cocOptions, countResources, nodeKey,
} from "../resource-tree";
import type { ResourceTreeRow } from "../resource-tree";

// Rows shaped exactly as the endpoint's LEFT JOIN returns them.
const row = (over: Partial<ResourceTreeRow>): ResourceTreeRow => ({
  eoc_id: 1, eoc_code: "LAB", eoc_name: "Labor", eoc_sort_order: 0,
  coc_id: null, coc_code: null, coc_name: null, coc_sort_order: null,
  resource_id: null, resource_name: null, resource_code: null, resource_type: null, status: null,
  ...over,
});

const labourWithTwoResources: ResourceTreeRow[] = [
  row({ coc_id: 10, coc_code: "DL", coc_name: "Direct Labor", coc_sort_order: 0,
        resource_id: "r1", resource_name: "Senior Engineer", resource_code: "ENG-1", resource_type: "labor", status: "active" }),
  row({ coc_id: 10, coc_code: "DL", coc_name: "Direct Labor", coc_sort_order: 0,
        resource_id: "r2", resource_name: "Technician", resource_code: null, resource_type: "labor", status: "inactive" }),
  row({ coc_id: 11, coc_code: "OT", coc_name: "Overtime", coc_sort_order: 1 }),
  row({ eoc_id: 2, eoc_code: "MAT", eoc_name: "Material", eoc_sort_order: 1,
        coc_id: 20, coc_code: "RAW", coc_name: "Raw Material", coc_sort_order: 0,
        resource_id: "r3", resource_name: "Aluminium sheet", resource_code: "AL", resource_type: "material", status: "active" }),
  row({ eoc_id: 3, eoc_code: "ODC", eoc_name: "Other", eoc_sort_order: 2 }),
];

describe("buildResourceTree", () => {
  it("groups a repeated category once, with its resources beneath", () => {
    const tree = buildResourceTree(labourWithTwoResources);
    expect(tree.map((e) => e.code)).toEqual(["LAB", "MAT", "ODC"]);
    expect(tree[0].classes.map((c) => c.code)).toEqual(["DL", "OT"]);
    expect(tree[0].classes[0].resources.map((r) => r.name)).toEqual(["Senior Engineer", "Technician"]);
  });

  it("keeps a cost class that has no resources", () => {
    // The join emits a row with resource_id null; dropping it would hide a
    // real, empty category the person may want to add a resource to.
    const tree = buildResourceTree(labourWithTwoResources);
    expect(tree[0].classes[1].code).toBe("OT");
    expect(tree[0].classes[1].resources).toEqual([]);
  });

  it("keeps an element of cost that has no classes at all", () => {
    const tree = buildResourceTree(labourWithTwoResources);
    const other = tree.find((e) => e.code === "ODC");
    expect(other).toBeDefined();
    expect(other?.classes).toEqual([]);
  });

  it("never invents a resource from a null join row", () => {
    const tree = buildResourceTree([row({ coc_id: 10, coc_code: "DL", coc_name: "Direct Labor", coc_sort_order: 0 })]);
    expect(countResources(tree)).toBe(0);
  });

  it("preserves the server's ordering rather than re-sorting", () => {
    // sort_order is the whole point of the seeded standard hierarchy; the
    // server already applied it, and re-sorting here would override it.
    const tree = buildResourceTree(labourWithTwoResources);
    expect(tree.map((e) => e.name)).toEqual(["Labor", "Material", "Other"]);
  });

  it("returns nothing for a project with no hierarchy yet", () => {
    expect(buildResourceTree([])).toEqual([]);
  });
});

describe("flattenResourceTree", () => {
  const tree = buildResourceTree(labourWithTwoResources);

  it("shows only elements of cost when nothing is expanded", () => {
    const rows = flattenResourceTree(tree, new Set());
    expect(rows.map((r) => r.name)).toEqual(["Labor", "Material", "Other"]);
    expect(rows[0].hasChildren).toBe(true);
    expect(rows[2].hasChildren).toBe(false);
  });

  it("reveals classes, then resources, one level at a time", () => {
    const oneLevel = flattenResourceTree(tree, new Set([nodeKey("eoc", 1)]));
    expect(oneLevel.map((r) => r.name)).toEqual(["Labor", "Direct Labor", "Overtime", "Material", "Other"]);

    const twoLevels = flattenResourceTree(tree, new Set([nodeKey("eoc", 1), nodeKey("coc", 10)]));
    expect(twoLevels.map((r) => r.name)).toEqual([
      "Labor", "Direct Labor", "Senior Engineer", "Technician", "Overtime", "Material", "Other",
    ]);
  });

  it("indents each level correctly", () => {
    const rows = flattenResourceTree(tree, new Set([nodeKey("eoc", 1), nodeKey("coc", 10)]));
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 2, 1, 0, 0]);
  });

  it("namespaces keys so an EOC and a COC with the same id don't collide", () => {
    // Both sequences start at 1, so raw ids would make expanding "1" open two
    // unrelated nodes.
    const collidingIds = buildResourceTree([
      row({ eoc_id: 1, coc_id: 1, coc_code: "DL", coc_name: "Direct Labor", coc_sort_order: 0 }),
    ]);
    const rows = flattenResourceTree(collidingIds, new Set([nodeKey("eoc", 1)]));
    expect(rows.map((r) => r.key)).toEqual(["eoc:1", "coc:1"]);
  });

  it("carries the parent ids a resource row needs for context", () => {
    const rows = flattenResourceTree(tree, new Set([nodeKey("eoc", 1), nodeKey("coc", 10)]));
    const resourceRow = rows.find((r) => r.kind === "resource");
    expect(resourceRow?.parentCocId).toBe(10);
    expect(resourceRow?.parentEocId).toBe(1);
  });

  it("won't mark an empty node expanded even if its key is in the set", () => {
    const rows = flattenResourceTree(tree, new Set([nodeKey("eoc", 3)]));
    expect(rows.find((r) => r.name === "Other")?.isExpanded).toBe(false);
  });
});

describe("expandableKeys", () => {
  it("lists only nodes that actually have children", () => {
    const keys = expandableKeys(buildResourceTree(labourWithTwoResources));
    expect([...keys].sort()).toEqual(["coc:10", "coc:20", "eoc:1", "eoc:2"]);
  });
});

describe("cocOptions", () => {
  it("qualifies each class with its element of cost", () => {
    // "DL" alone is meaningless in a dropdown; "Labor › DL Direct Labor" isn't.
    expect(cocOptions(buildResourceTree(labourWithTwoResources))).toEqual([
      { coc_id: 10, label: "Labor › DL Direct Labor" },
      { coc_id: 11, label: "Labor › OT Overtime" },
      { coc_id: 20, label: "Material › RAW Raw Material" },
    ]);
  });
});

describe("countResources", () => {
  it("counts across the whole tree", () => {
    expect(countResources(buildResourceTree(labourWithTwoResources))).toBe(3);
  });
});
