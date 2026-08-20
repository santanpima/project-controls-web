// WBS's view of the shared hierarchy logic (7.1.1.2.1).
//
// The generic implementation now lives in @shared/tree/hierarchy, so WBS and
// OBS render their trees through exactly one set of rules rather than two
// copies that could drift. This module is what binds that generic logic to
// WBS's own field names and its own sibling ordering; its public API is
// unchanged, and its existing tests still cover the behaviour end to end.
import {
  buildTree as buildGenericTree,
  flattenVisible as flattenGenericVisible,
  idsWithChildren as genericIdsWithChildren,
  ancestorIds as genericAncestorIds,
  descendantIds as genericDescendantIds,
  validMoveTargets as genericValidMoveTargets,
  compareDottedCodes,
} from "@shared/tree/hierarchy";
import type { HierarchyAccessors, TreeNode, TreeRow } from "@shared/tree/hierarchy";

// Structural minimum this module depends on — deliberately not the full
// WbsElement type from the API module, so the logic here stays testable with
// small fixtures and can't drift into depending on unrelated fields.
export interface WbsNodeLike {
  wbs_id: string;
  parent_wbs_id: string | null;
  code: string;
  name: string;
}

export type WbsTreeNode<T extends WbsNodeLike> = TreeNode<T>;
export type WbsRow<T extends WbsNodeLike> = TreeRow<T>;

// 1.2 before 1.10, not after it: the server orders the tree by the materialized
// code string, and string ordering is wrong for a work breakdown structure the
// moment any parent has ten or more children.
export const compareWbsCodes = compareDottedCodes;

function accessors<T extends WbsNodeLike>(): HierarchyAccessors<T> {
  return {
    getId: (e) => e.wbs_id,
    getParentId: (e) => e.parent_wbs_id,
    compare: (a, b) => compareWbsCodes(a.code, b.code),
  };
}

export function buildTree<T extends WbsNodeLike>(elements: T[]): WbsTreeNode<T>[] {
  return buildGenericTree(elements, accessors<T>());
}

export function flattenVisible<T extends WbsNodeLike>(
  nodes: WbsTreeNode<T>[],
  expandedIds: ReadonlySet<string>,
  depth = 0
): WbsRow<T>[] {
  return flattenGenericVisible(nodes, expandedIds, accessors<T>(), depth);
}

export function idsWithChildren<T extends WbsNodeLike>(elements: T[]): Set<string> {
  return genericIdsWithChildren(elements, accessors<T>());
}

export function ancestorIds<T extends WbsNodeLike>(elements: T[], wbsId: string): string[] {
  return genericAncestorIds(elements, wbsId, accessors<T>());
}

export function descendantIds<T extends WbsNodeLike>(elements: T[], wbsId: string): Set<string> {
  return genericDescendantIds(elements, wbsId, accessors<T>());
}

export function validMoveTargets<T extends WbsNodeLike>(elements: T[], wbsId: string): T[] {
  return genericValidMoveTargets(elements, wbsId, accessors<T>());
}
