// Pure tree logic for the WBS outline (7.1.1.2.1) — no React, no API
// client, no DOM. Kept in its own module for the same reason
// day-resolution.ts is: this is the part with real edge cases worth unit
// testing directly, and none of it needs a rendered component or a live
// backend to test.
//
// The backend returns the project's elements as a flat list already
// ordered parents-before-children (a recursive CTE sorted by the
// materialized code path). This module turns that flat list into the
// nested shape a tree view actually renders from, and answers the two
// structural questions the screen needs: what's visible given which nodes
// are expanded, and which elements a given node may legally be moved
// under.

// Structural minimum this module depends on — deliberately not the full
// WbsElement type from the API module, so the logic here stays testable
// with small fixtures and can't drift into depending on unrelated fields.
export interface WbsNodeLike {
  wbs_id: string;
  parent_wbs_id: string | null;
  code: string;
  name: string;
}

export interface WbsTreeNode<T extends WbsNodeLike> {
  element: T;
  children: WbsTreeNode<T>[];
}

export interface WbsRow<T extends WbsNodeLike> {
  element: T;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
}

// Compares two WBS codes the way a person reads them: 1.2 before 1.10,
// not after it.
//
// This exists because the server orders the tree by the materialized code
// string, and string ordering puts "1.10" before "1.2" — correct
// alphabetically, wrong for a work breakdown structure, and visible the
// moment any parent has ten or more children. Codes in this application
// are always server-generated as dot-separated positions (service.js's
// childCode), so comparing segment by segment as numbers is safe; a
// segment that isn't numeric falls back to plain string comparison rather
// than silently sorting as zero.
export function compareWbsCodes(a: string, b: string): number {
  const left = a.split(".");
  const right = b.split(".");
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const l = left[i];
    const r = right[i];
    if (l === undefined) return -1; // "1.2" sorts before "1.2.1"
    if (r === undefined) return 1;
    const ln = Number(l);
    const rn = Number(r);
    const bothNumeric = l !== "" && r !== "" && Number.isFinite(ln) && Number.isFinite(rn);
    if (bothNumeric) {
      if (ln !== rn) return ln - rn;
    } else if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return 0;
}

// Builds the nested tree from the flat list, sorting each sibling group by
// WBS code numerically (see compareWbsCodes above for why the server's own
// string ordering isn't sufficient).
//
// One honest edge case, handled rather than assumed away: an element whose
// parent_wbs_id points at something not present in the list (a parent
// soft-deleted out from under it, say) would otherwise vanish from the
// tree entirely. Those are surfaced as roots instead — visible and
// editable, never silently dropped.
export function buildTree<T extends WbsNodeLike>(elements: T[]): WbsTreeNode<T>[] {
  const nodesById = new Map<string, WbsTreeNode<T>>();
  for (const element of elements) {
    nodesById.set(element.wbs_id, { element, children: [] });
  }

  const roots: WbsTreeNode<T>[] = [];
  for (const element of elements) {
    const node = nodesById.get(element.wbs_id) as WbsTreeNode<T>;
    const parent = element.parent_wbs_id ? nodesById.get(element.parent_wbs_id) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortByCode = (nodes: WbsTreeNode<T>[]) => {
    nodes.sort((x, y) => compareWbsCodes(x.element.code, y.element.code));
    for (const node of nodes) sortByCode(node.children);
  };
  sortByCode(roots);

  return roots;
}

// Flattens the tree back into the row list actually rendered, skipping the
// subtree beneath any collapsed node. Depth comes from the tree position
// rather than the element's own `level` column, so indentation stays
// correct even for an orphan promoted to a root by buildTree above.
export function flattenVisible<T extends WbsNodeLike>(
  nodes: WbsTreeNode<T>[],
  expandedIds: ReadonlySet<string>,
  depth = 0
): WbsRow<T>[] {
  const rows: WbsRow<T>[] = [];
  for (const node of nodes) {
    const hasChildren = node.children.length > 0;
    const isExpanded = hasChildren && expandedIds.has(node.element.wbs_id);
    rows.push({ element: node.element, depth, hasChildren, isExpanded });
    if (isExpanded) {
      rows.push(...flattenVisible(node.children, expandedIds, depth + 1));
    }
  }
  return rows;
}

// Every element that has at least one child — what "expand all" needs, and
// the default expanded set on first load.
export function idsWithChildren<T extends WbsNodeLike>(elements: T[]): Set<string> {
  const parents = new Set<string>();
  for (const element of elements) {
    if (element.parent_wbs_id) parents.add(element.parent_wbs_id);
  }
  return parents;
}

// The ancestor chain from the root down to (but not including) the given
// element — what has to be expanded for a given element to be visible.
export function ancestorIds<T extends WbsNodeLike>(elements: T[], wbsId: string): string[] {
  const byId = new Map(elements.map((e) => [e.wbs_id, e]));
  const chain: string[] = [];
  let current = byId.get(wbsId)?.parent_wbs_id ?? null;
  // A malformed cycle can't be reached through the API (the database's own
  // trigger prevents one), but guarding the walk costs nothing and beats
  // an infinite loop in the browser if one ever did arrive.
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    chain.unshift(current);
    current = byId.get(current)?.parent_wbs_id ?? null;
  }
  return chain;
}

// Every descendant of an element, itself excluded.
export function descendantIds<T extends WbsNodeLike>(elements: T[], wbsId: string): Set<string> {
  const childrenByParent = new Map<string, T[]>();
  for (const element of elements) {
    if (!element.parent_wbs_id) continue;
    const siblings = childrenByParent.get(element.parent_wbs_id);
    if (siblings) siblings.push(element);
    else childrenByParent.set(element.parent_wbs_id, [element]);
  }

  const collected = new Set<string>();
  const queue = [wbsId];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    for (const child of childrenByParent.get(next) ?? []) {
      if (collected.has(child.wbs_id)) continue;
      collected.add(child.wbs_id);
      queue.push(child.wbs_id);
    }
  }
  return collected;
}

// 7.1.1.1.2 — where an element may legally be moved. The database's own
// cycle-prevention trigger is the real enforcement (a bad move is refused
// server-side regardless of what any screen offers); this is what keeps
// the person from being offered a destination that would just be rejected.
// Excluded: the element itself, its own descendants, and its current
// parent (moving somewhere it already is isn't a move).
export function validMoveTargets<T extends WbsNodeLike>(elements: T[], wbsId: string): T[] {
  const blocked = descendantIds(elements, wbsId);
  blocked.add(wbsId);
  const current = elements.find((e) => e.wbs_id === wbsId);
  return elements.filter(
    (candidate) => !blocked.has(candidate.wbs_id) && candidate.wbs_id !== current?.parent_wbs_id
  );
}
