import { describe, it, expect } from "vitest";
import {
  buildTree, flattenVisible, idsWithChildren, ancestorIds, descendantIds, validMoveTargets,
} from "../wbs-tree";
import type { WbsNodeLike } from "../wbs-tree";

// A small but genuinely representative tree:
//   1     Aircraft System
//   1.1     Airframe
//   1.1.1     Wing Assembly
//   1.2     Avionics
//   2     Program Management
const element = (id: string, parent: string | null, code: string, name: string): WbsNodeLike => ({
  wbs_id: id, parent_wbs_id: parent, code, name,
});

const tree: WbsNodeLike[] = [
  element("a", null, "1", "Aircraft System"),
  element("b", "a", "1.1", "Airframe"),
  element("c", "b", "1.1.1", "Wing Assembly"),
  element("d", "a", "1.2", "Avionics"),
  element("e", null, "2", "Program Management"),
];

const allIds = (rows: { element: WbsNodeLike }[]) => rows.map((r) => r.element.wbs_id);

describe("buildTree", () => {
  it("nests children under their parents and keeps two roots separate", () => {
    const roots = buildTree(tree);
    expect(roots.map((r) => r.element.wbs_id)).toEqual(["a", "e"]);
    expect(roots[0].children.map((c) => c.element.wbs_id)).toEqual(["b", "d"]);
    expect(roots[0].children[0].children.map((c) => c.element.wbs_id)).toEqual(["c"]);
  });

  it("still builds correctly when children arrive before their parents", () => {
    // The backend orders parents first, but nothing about this logic should
    // depend on that — a two-pass build shouldn't care about input order.
    const reversed = [...tree].reverse();
    const roots = buildTree(reversed);
    const aircraft = roots.find((r) => r.element.wbs_id === "a");
    expect(aircraft?.children.map((c) => c.element.wbs_id).sort()).toEqual(["b", "d"]);
  });

  it("promotes an orphan to a root rather than dropping it", () => {
    const orphaned = [element("x", "missing-parent", "9", "Orphaned Element")];
    const roots = buildTree(orphaned);
    expect(roots.map((r) => r.element.wbs_id)).toEqual(["x"]);
  });
});

describe("flattenVisible", () => {
  it("shows only roots when nothing is expanded", () => {
    const rows = flattenVisible(buildTree(tree), new Set());
    expect(allIds(rows)).toEqual(["a", "e"]);
    expect(rows[0].hasChildren).toBe(true);
    expect(rows[0].isExpanded).toBe(false);
    expect(rows[1].hasChildren).toBe(false);
  });

  it("reveals exactly one level per expanded node", () => {
    const rows = flattenVisible(buildTree(tree), new Set(["a"]));
    expect(allIds(rows)).toEqual(["a", "b", "d", "e"]);
  });

  it("reveals a grandchild only when both ancestors are expanded", () => {
    const rows = flattenVisible(buildTree(tree), new Set(["a", "b"]));
    expect(allIds(rows)).toEqual(["a", "b", "c", "d", "e"]);
    expect(rows.find((r) => r.element.wbs_id === "c")?.depth).toBe(2);
  });

  it("ignores an expanded id belonging to a node with no children", () => {
    const rows = flattenVisible(buildTree(tree), new Set(["a", "d"]));
    expect(allIds(rows)).toEqual(["a", "b", "d", "e"]);
    expect(rows.find((r) => r.element.wbs_id === "d")?.isExpanded).toBe(false);
  });

  it("reports depth from tree position, not the stored level column", () => {
    const rows = flattenVisible(buildTree(tree), new Set(["a", "b"]));
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 1, 0]);
  });
});

describe("idsWithChildren", () => {
  it("returns every element that is some other element's parent", () => {
    expect([...idsWithChildren(tree)].sort()).toEqual(["a", "b"]);
  });
});

describe("ancestorIds", () => {
  it("returns the root-first chain above an element", () => {
    expect(ancestorIds(tree, "c")).toEqual(["a", "b"]);
  });

  it("returns nothing for a root", () => {
    expect(ancestorIds(tree, "a")).toEqual([]);
  });
});

describe("descendantIds", () => {
  it("collects the whole subtree, excluding the element itself", () => {
    expect([...descendantIds(tree, "a")].sort()).toEqual(["b", "c", "d"]);
    expect([...descendantIds(tree, "b")]).toEqual(["c"]);
    expect([...descendantIds(tree, "c")]).toEqual([]);
  });
});

describe("validMoveTargets", () => {
  it("excludes the element itself and everything beneath it", () => {
    // Moving Airframe under its own Wing Assembly is exactly the cycle the
    // database trigger refuses — it should never be offered in the first place.
    const targets = validMoveTargets(tree, "b").map((t) => t.wbs_id);
    expect(targets).not.toContain("b");
    expect(targets).not.toContain("c");
  });

  it("excludes the element's current parent, since that isn't a move", () => {
    expect(validMoveTargets(tree, "b").map((t) => t.wbs_id)).not.toContain("a");
  });

  it("offers the legitimate remaining destinations", () => {
    expect(validMoveTargets(tree, "b").map((t) => t.wbs_id).sort()).toEqual(["d", "e"]);
  });
});
