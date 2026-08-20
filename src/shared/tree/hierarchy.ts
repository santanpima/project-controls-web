// Generic hierarchy logic, shared by every module that renders a parent/child
// tree — WBS (7.1.1.2.1) and OBS (8.1.1.1.3) today, and the EOC/COC and
// resource hierarchies whenever those screens are built.
//
// This started life inside the WBS screen, hardcoded to wbs_id/parent_wbs_id.
// Lifting it here rather than copying it into OBS keeps one implementation and
// one set of tests: the specification itself says the OBS view reuses the WBS
// view's approach (8.1.1.1.3's own note), so the code should reuse it too.
// Everything is pure — no React, no API client, no DOM.

// How to read a given module's rows: their own id and parent-id fields differ
// (wbs_id/parent_wbs_id, org_id/parent_obs_id), and so does the order siblings
// should appear in.
export interface HierarchyAccessors<T> {
  getId: (item: T) => string;
  getParentId: (item: T) => string | null;
  // Optional sibling ordering. Omitted, the input order is preserved, which is
  // what a server that already sorted its rows deserves.
  compare?: (a: T, b: T) => number;
}

export interface TreeNode<T> {
  element: T;
  children: TreeNode<T>[];
}

export interface TreeRow<T> {
  element: T;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
}

// Builds the nested tree from a flat list.
//
// One honest edge case, handled rather than assumed away: an element whose
// parent id points at something not present in the list (a parent soft-deleted
// out from under it, say) would otherwise vanish from the tree entirely. Those
// are surfaced as roots instead — visible and editable, never silently dropped.
export function buildTree<T>(items: T[], accessors: HierarchyAccessors<T>): TreeNode<T>[] {
  const { getId, getParentId, compare } = accessors;
  const nodesById = new Map<string, TreeNode<T>>();
  for (const item of items) {
    nodesById.set(getId(item), { element: item, children: [] });
  }

  const roots: TreeNode<T>[] = [];
  for (const item of items) {
    const node = nodesById.get(getId(item)) as TreeNode<T>;
    const parentId = getParentId(item);
    const parent = parentId ? nodesById.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  if (compare) {
    const sortRecursively = (nodes: TreeNode<T>[]) => {
      nodes.sort((x, y) => compare(x.element, y.element));
      for (const node of nodes) sortRecursively(node.children);
    };
    sortRecursively(roots);
  }

  return roots;
}

// Flattens the tree into the row list actually rendered, skipping the subtree
// beneath any collapsed node. Depth comes from tree position rather than a
// stored level column, so indentation stays correct even for an orphan that
// buildTree promoted to a root.
export function flattenVisible<T>(
  nodes: TreeNode<T>[],
  expandedIds: ReadonlySet<string>,
  accessors: Pick<HierarchyAccessors<T>, "getId">,
  depth = 0
): TreeRow<T>[] {
  const rows: TreeRow<T>[] = [];
  for (const node of nodes) {
    const hasChildren = node.children.length > 0;
    const isExpanded = hasChildren && expandedIds.has(accessors.getId(node.element));
    rows.push({ element: node.element, depth, hasChildren, isExpanded });
    if (isExpanded) rows.push(...flattenVisible(node.children, expandedIds, accessors, depth + 1));
  }
  return rows;
}

// Every element that has at least one child — what "expand all" needs, and the
// default expanded set on first load.
export function idsWithChildren<T>(items: T[], accessors: Pick<HierarchyAccessors<T>, "getParentId">): Set<string> {
  const parents = new Set<string>();
  for (const item of items) {
    const parentId = accessors.getParentId(item);
    if (parentId) parents.add(parentId);
  }
  return parents;
}

// The ancestor chain from the root down to (but not including) the given
// element — what has to be expanded for that element to be visible.
export function ancestorIds<T>(items: T[], id: string, accessors: HierarchyAccessors<T>): string[] {
  const byId = new Map(items.map((item) => [accessors.getId(item), item]));
  const chain: string[] = [];
  const start = byId.get(id);
  let current = start ? accessors.getParentId(start) : null;
  // A malformed cycle can't arrive through the API (the database's own trigger
  // prevents one), but guarding the walk costs nothing and beats an infinite
  // loop in the browser if one ever did.
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    chain.unshift(current);
    const parent = byId.get(current);
    current = parent ? accessors.getParentId(parent) : null;
  }
  return chain;
}

// Every descendant of an element, itself excluded.
export function descendantIds<T>(items: T[], id: string, accessors: HierarchyAccessors<T>): Set<string> {
  const childrenByParent = new Map<string, T[]>();
  for (const item of items) {
    const parentId = accessors.getParentId(item);
    if (!parentId) continue;
    const siblings = childrenByParent.get(parentId);
    if (siblings) siblings.push(item);
    else childrenByParent.set(parentId, [item]);
  }

  const collected = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    for (const child of childrenByParent.get(next) ?? []) {
      const childId = accessors.getId(child);
      if (collected.has(childId)) continue;
      collected.add(childId);
      queue.push(childId);
    }
  }
  return collected;
}

// Where an element may legally be moved. The database's own cycle-prevention
// trigger is the real enforcement — a bad move is refused server-side whatever
// a screen offers — but this keeps a person from being offered a destination
// that would only be rejected. Excluded: the element itself, its descendants,
// and its current parent (moving somewhere it already is isn't a move).
export function validMoveTargets<T>(items: T[], id: string, accessors: HierarchyAccessors<T>): T[] {
  const blocked = descendantIds(items, id, accessors);
  blocked.add(id);
  const current = items.find((item) => accessors.getId(item) === id);
  const currentParentId = current ? accessors.getParentId(current) : null;
  return items.filter(
    (candidate) => !blocked.has(accessors.getId(candidate)) && accessors.getId(candidate) !== currentParentId
  );
}

// Compares dotted numeric codes the way a person reads them: 1.2 before 1.10,
// not after it. Used by WBS, whose codes are always server-generated as
// dot-separated positions; a segment that isn't numeric falls back to plain
// string comparison rather than silently sorting as zero.
export function compareDottedCodes(a: string, b: string): number {
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
