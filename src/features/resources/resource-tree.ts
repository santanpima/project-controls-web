// Folding the resource tree endpoint's rows into an actual tree.
//
// The endpoint returns a denormalised join: one row per EOC × COC × Resource,
// with LEFT JOINs so an EOC with no cost classes still appears (coc_id null),
// and a cost class with no resources still appears (resource_id null). Reading
// those rows naively produces duplicate categories and phantom resources, so
// the folding is done once, here, where it can be tested.
//
// Pure — no React, no API client, no DOM.

export interface ResourceTreeRow {
  eoc_id: number;
  eoc_code: string;
  eoc_name: string;
  eoc_sort_order: number;
  coc_id: number | null;
  coc_code: string | null;
  coc_name: string | null;
  coc_sort_order: number | null;
  resource_id: string | null;
  resource_name: string | null;
  resource_code: string | null;
  resource_type: string | null;
  status: string | null;
}

export interface ResourceLeaf {
  resource_id: string;
  name: string;
  code: string | null;
  resource_type: string;
  status: string;
}

export interface CocNode {
  coc_id: number;
  code: string;
  name: string;
  resources: ResourceLeaf[];
}

export interface EocNode {
  eoc_id: number;
  code: string;
  name: string;
  classes: CocNode[];
}

// Row order is the server's (sort_order, then resource name) and is preserved
// rather than re-sorted: those sort_order columns are the whole point of the
// standard hierarchy's shape, and re-sorting here would quietly override them.
export function buildResourceTree(rows: ResourceTreeRow[]): EocNode[] {
  const eocs: EocNode[] = [];
  const eocById = new Map<number, EocNode>();
  const cocById = new Map<number, CocNode>();

  for (const row of rows) {
    let eoc = eocById.get(row.eoc_id);
    if (!eoc) {
      eoc = { eoc_id: row.eoc_id, code: row.eoc_code, name: row.eoc_name, classes: [] };
      eocById.set(row.eoc_id, eoc);
      eocs.push(eoc);
    }

    // An EOC with no cost classes at all still arrives as a row, with every
    // COC column null. That's a real category to display, not a broken row.
    if (row.coc_id === null) continue;

    let coc = cocById.get(row.coc_id);
    if (!coc) {
      coc = { coc_id: row.coc_id, code: row.coc_code ?? "", name: row.coc_name ?? "", resources: [] };
      cocById.set(row.coc_id, coc);
      eoc.classes.push(coc);
    }

    // Likewise a cost class with no resources — the join still produces the
    // row, and adding a resource from it would invent one.
    if (row.resource_id === null) continue;

    coc.resources.push({
      resource_id: row.resource_id,
      name: row.resource_name ?? "",
      code: row.resource_code,
      resource_type: row.resource_type ?? "",
      status: row.status ?? "active",
    });
  }

  return eocs;
}

export type NodeKind = "eoc" | "coc" | "resource";

export interface DisplayRow {
  kind: NodeKind;
  // Namespaced because the three levels have independent id sequences: an EOC
  // and a COC can both legitimately be id 3, and a Set of raw ids would
  // collapse them into one expandable node.
  key: string;
  id: string | number;
  depth: number;
  code: string | null;
  name: string;
  hasChildren: boolean;
  isExpanded: boolean;
  resource?: ResourceLeaf;
  parentCocId?: number;
  parentEocId?: number;
}

export function nodeKey(kind: NodeKind, id: string | number): string {
  return `${kind}:${id}`;
}

// Flattens to the rows actually rendered, skipping anything beneath a
// collapsed node.
export function flattenResourceTree(tree: EocNode[], expandedKeys: ReadonlySet<string>): DisplayRow[] {
  const rows: DisplayRow[] = [];

  for (const eoc of tree) {
    const eocKey = nodeKey("eoc", eoc.eoc_id);
    const eocExpanded = expandedKeys.has(eocKey) && eoc.classes.length > 0;
    rows.push({
      kind: "eoc",
      key: eocKey,
      id: eoc.eoc_id,
      depth: 0,
      code: eoc.code,
      name: eoc.name,
      hasChildren: eoc.classes.length > 0,
      isExpanded: eocExpanded,
    });
    if (!eocExpanded) continue;

    for (const coc of eoc.classes) {
      const cocKey = nodeKey("coc", coc.coc_id);
      const cocExpanded = expandedKeys.has(cocKey) && coc.resources.length > 0;
      rows.push({
        kind: "coc",
        key: cocKey,
        id: coc.coc_id,
        depth: 1,
        code: coc.code,
        name: coc.name,
        hasChildren: coc.resources.length > 0,
        isExpanded: cocExpanded,
        parentEocId: eoc.eoc_id,
      });
      if (!cocExpanded) continue;

      for (const resource of coc.resources) {
        rows.push({
          kind: "resource",
          key: nodeKey("resource", resource.resource_id),
          id: resource.resource_id,
          depth: 2,
          code: resource.code,
          name: resource.name,
          hasChildren: false,
          isExpanded: false,
          resource,
          parentCocId: coc.coc_id,
          parentEocId: eoc.eoc_id,
        });
      }
    }
  }

  return rows;
}

// Every node that has children — the default expanded set, and what an
// "expand all" control needs.
export function expandableKeys(tree: EocNode[]): Set<string> {
  const keys = new Set<string>();
  for (const eoc of tree) {
    if (eoc.classes.length > 0) keys.add(nodeKey("eoc", eoc.eoc_id));
    for (const coc of eoc.classes) {
      if (coc.resources.length > 0) keys.add(nodeKey("coc", coc.coc_id));
    }
  }
  return keys;
}

// Flat list of every cost class, for a "which class does this resource belong
// to" selector — where the EOC's name has to be shown alongside, since class
// codes like "DL" mean little without "Labor" in front of them.
export interface CocOption {
  coc_id: number;
  label: string;
}

export function cocOptions(tree: EocNode[]): CocOption[] {
  const options: CocOption[] = [];
  for (const eoc of tree) {
    for (const coc of eoc.classes) {
      options.push({ coc_id: coc.coc_id, label: `${eoc.name} › ${coc.code} ${coc.name}` });
    }
  }
  return options;
}

export function countResources(tree: EocNode[]): number {
  return tree.reduce(
    (total, eoc) => total + eoc.classes.reduce((sum, coc) => sum + coc.resources.length, 0),
    0
  );
}
