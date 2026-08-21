// The arithmetic behind the Cost screen (Theme 11, Epic 11.4), kept as pure
// functions so it can be tested without a browser, a server, or a database.
//
// Why this exists at all rather than asking the server for each figure: the
// backend can already total any one WBS subtree, but a screen showing the
// whole tree with a figure on every node would need one request per element.
// Every estimate in the project arrives in a single call instead, and the
// per-node totals are folded here, once.
//
// The central rule, and the reason several of these functions return a
// separate "unrated" count alongside the money: **an estimate with no rate is
// worth zero.** Every budget query in the application multiplies base_value by
// COALESCE(rate, 0), so five hundred hours with no rate contributes exactly
// nothing to the total. That is defensible arithmetic and indefensible if it
// is shown to a person as though the work had been costed. These functions
// therefore never hand back a bare number where a zero could be mistaken for a
// real figure — they hand back the total *and* how many estimates were
// silently contributing nothing to it.

import { buildTree } from "@shared/tree/hierarchy";
import type { HierarchyAccessors, TreeNode } from "@shared/tree/hierarchy";
import { compareDottedCodes } from "@shared/tree/hierarchy";

// Structural minimum, deliberately not the full API types, so these functions
// stay testable with small fixtures and can't drift into depending on fields
// they have no business reading.
export interface WbsNodeLike {
  wbs_id: string;
  parent_wbs_id: string | null;
  code: string;
  name: string;
  planning_element_type?: string | null;
}

export interface EstimateLike {
  estimate_id: number;
  wbs_id: string;
  base_value: string | number;
  rate: string | number | null;
  fiscal_period_id: string | null;
}

// The pg driver returns NUMERIC columns as strings, because a JavaScript number
// cannot hold every value a NUMERIC(14,4) can. Parsing is therefore explicit
// everywhere, and anything unparseable becomes null rather than NaN — a NaN
// propagates silently through every sum it touches and turns a whole column of
// figures into "NaN" with no indication of which row caused it.
export function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// What one estimate is worth. Null rate means null value — not zero — so the
// caller has to decide what to display rather than being handed a number that
// looks costed.
export function estimateValue(estimate: EstimateLike): number | null {
  const base = toNumber(estimate.base_value);
  const rate = toNumber(estimate.rate);
  if (base === null || rate === null) return null;
  return base * rate;
}

export interface BudgetTotal {
  // The money, summing only estimates that have a rate.
  value: number;
  // How many estimates were counted, and how many were skipped for having no
  // rate. A total of 0 with unrated > 0 means something quite different from a
  // total of 0 with unrated === 0, and the screen says which.
  estimateCount: number;
  unratedCount: number;
}

export const EMPTY_TOTAL: BudgetTotal = { value: 0, estimateCount: 0, unratedCount: 0 };

export function sumEstimates(estimates: readonly EstimateLike[]): BudgetTotal {
  let value = 0;
  let unratedCount = 0;
  for (const estimate of estimates) {
    const each = estimateValue(estimate);
    if (each === null) unratedCount += 1;
    else value += each;
  }
  return { value, estimateCount: estimates.length, unratedCount };
}

function addTotals(a: BudgetTotal, b: BudgetTotal): BudgetTotal {
  return {
    value: a.value + b.value,
    estimateCount: a.estimateCount + b.estimateCount,
    unratedCount: a.unratedCount + b.unratedCount,
  };
}

function wbsAccessors<T extends WbsNodeLike>(): HierarchyAccessors<T> {
  return {
    getId: (e) => e.wbs_id,
    getParentId: (e) => e.parent_wbs_id,
    compare: (a, b) => compareDottedCodes(a.code, b.code),
  };
}

/**
 * Groups estimates by the WBS element they are attached to.
 *
 * Estimates whose WBS element isn't in the supplied list are dropped rather
 * than grouped under a phantom key — that happens when an element is
 * soft-deleted, and counting its estimates into a project total would
 * overstate the budget against a tree that no longer contains the work.
 */
export function estimatesByWbsId(
  estimates: readonly EstimateLike[],
  knownWbsIds: ReadonlySet<string>
): Map<string, EstimateLike[]> {
  const byWbs = new Map<string, EstimateLike[]>();
  for (const estimate of estimates) {
    if (!knownWbsIds.has(estimate.wbs_id)) continue;
    const existing = byWbs.get(estimate.wbs_id);
    if (existing) existing.push(estimate);
    else byWbs.set(estimate.wbs_id, [estimate]);
  }
  return byWbs;
}

export interface RollupResult {
  /** What is attached to this element itself. */
  direct: Map<string, BudgetTotal>;
  /** This element plus everything beneath it. */
  subtree: Map<string, BudgetTotal>;
}

/**
 * Rolls estimates up the WBS tree, so every element carries both its own
 * figure and its subtree's.
 *
 * Both are kept because they answer different questions and confusing them is
 * a real reporting error: a control account's *direct* figure is usually zero
 * (estimates live on the work packages beneath it), while its *subtree* figure
 * is its actual budget. Showing only one of the two would either make every
 * summary node look unfunded or make every leaf look like it contained its
 * parent's money.
 *
 * A single traversal, not one per node: computing each subtree independently
 * would be quadratic in tree depth for no benefit.
 */
export function rollUpBudget<T extends WbsNodeLike>(
  elements: readonly T[],
  estimates: readonly EstimateLike[]
): RollupResult {
  const knownWbsIds = new Set(elements.map((e) => e.wbs_id));
  const byWbs = estimatesByWbsId(estimates, knownWbsIds);

  const direct = new Map<string, BudgetTotal>();
  for (const element of elements) {
    direct.set(element.wbs_id, sumEstimates(byWbs.get(element.wbs_id) ?? []));
  }

  const subtree = new Map<string, BudgetTotal>();
  const roots = buildTree([...elements], wbsAccessors<T>());

  const visit = (node: TreeNode<T>): BudgetTotal => {
    let total = direct.get(node.element.wbs_id) ?? EMPTY_TOTAL;
    for (const child of node.children) {
      total = addTotals(total, visit(child));
    }
    subtree.set(node.element.wbs_id, total);
    return total;
  };
  for (const root of roots) visit(root);

  return { direct, subtree };
}

/** The project's whole budget — every root's subtree added together. */
export function projectTotal<T extends WbsNodeLike>(
  elements: readonly T[],
  rollup: RollupResult
): BudgetTotal {
  let total = EMPTY_TOTAL;
  for (const element of elements) {
    if (element.parent_wbs_id === null || !elements.some((e) => e.wbs_id === element.parent_wbs_id)) {
      total = addTotals(total, rollup.subtree.get(element.wbs_id) ?? EMPTY_TOTAL);
    }
  }
  return total;
}

// --- Time phasing ------------------------------------------------------------

export interface PeriodLike {
  fiscal_period_id: string;
  period_number: number;
  start_date: string;
  end_date: string;
}

export interface PeriodColumn {
  fiscalPeriodId: string | null; // null is the "no period" column
  label: string;
  total: BudgetTotal;
}

/**
 * The time-phased view: one column per fiscal period that actually carries
 * estimates, plus an explicit column for estimates tagged to no period at all.
 *
 * The unphased column is deliberately visible rather than quietly excluded.
 * The fiscal period is nullable in the database, so unphased estimates are a
 * real state, they count toward the project total, and a time-phased table
 * that dropped them would disagree with the tree beside it for no visible
 * reason.
 *
 * Periods with no estimates are omitted — a fiscal calendar can hold thirteen
 * periods, and a wall of empty columns is not information.
 */
export function phaseByPeriod(
  estimates: readonly EstimateLike[],
  periods: readonly PeriodLike[]
): PeriodColumn[] {
  const byPeriod = new Map<string | null, EstimateLike[]>();
  for (const estimate of estimates) {
    const key = estimate.fiscal_period_id ?? null;
    const existing = byPeriod.get(key);
    if (existing) existing.push(estimate);
    else byPeriod.set(key, [estimate]);
  }

  const periodsById = new Map(periods.map((p) => [p.fiscal_period_id, p]));
  const columns: PeriodColumn[] = [];

  for (const period of periods) {
    const forPeriod = byPeriod.get(period.fiscal_period_id);
    if (!forPeriod) continue;
    columns.push({
      fiscalPeriodId: period.fiscal_period_id,
      label: periodLabel(period),
      total: sumEstimates(forPeriod),
    });
  }

  // An estimate can point at a period this calendar doesn't list — the project
  // was reassigned to a different calendar after the estimate was tagged.
  // Surfaced under its own heading rather than dropped.
  for (const [key, forPeriod] of byPeriod) {
    if (key !== null && !periodsById.has(key)) {
      columns.push({ fiscalPeriodId: key, label: "Unknown period", total: sumEstimates(forPeriod) });
    }
  }

  const unphased = byPeriod.get(null);
  if (unphased) {
    columns.push({ fiscalPeriodId: null, label: "No period", total: sumEstimates(unphased) });
  }

  return columns;
}

export function periodLabel(period: PeriodLike): string {
  return `P${period.period_number} · ${period.start_date.slice(0, 10)}`;
}

// --- Presentation helpers ----------------------------------------------------

/**
 * Money, formatted for the project's own currency.
 *
 * Falls back to plain grouped digits rather than guessing a symbol when the
 * currency code isn't one the browser recognises: a wrong currency symbol on a
 * cost figure is worse than none.
 */
export function formatMoney(value: number, currencyCode: string | null): string {
  if (currencyCode) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode,
        maximumFractionDigits: 0,
      }).format(value);
    } catch {
      // fall through to the plain format below
    }
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

/**
 * How a total should read on screen.
 *
 * A total of zero is ambiguous on its own — nothing estimated yet, or plenty
 * estimated with no rates attached. This resolves that ambiguity in one place
 * so every part of the screen answers it the same way.
 */
export function describeTotal(total: BudgetTotal, currencyCode: string | null): {
  text: string;
  caveat: string | null;
} {
  if (total.estimateCount === 0) {
    return { text: "—", caveat: null };
  }
  if (total.unratedCount === 0) {
    return { text: formatMoney(total.value, currencyCode), caveat: null };
  }
  const noun = total.unratedCount === 1 ? "estimate has" : "estimates have";
  return {
    text: formatMoney(total.value, currencyCode),
    caveat:
      total.unratedCount === total.estimateCount
        ? `No rate on ${total.unratedCount === 1 ? "the estimate" : `any of the ${total.unratedCount} estimates`} here, so nothing is costed yet.`
        : `${total.unratedCount} ${noun} no rate and add nothing to this figure.`,
  };
}

/**
 * What is worth saying about where an estimate is being placed.
 *
 * This function was wrong in its first version and the correction is worth
 * recording, because the wrong version was the plausible reading of the
 * specification rather than of the code. It used to tell people that an
 * unclassified element's estimates "won't appear in the time-phased budget".
 * They do. The server's rollup starts at each control account and then
 * recurses into **every** descendant regardless of classification, so an
 * unclassified element sitting beneath a control account contributes in full.
 * Verified directly against the database rather than inferred from the
 * specification's narrower language about work packages.
 *
 * What actually decides whether an estimate reaches the control-account
 * rollup is therefore not its own classification at all — it is whether it has
 * a control account somewhere above it. That is what this reports.
 */
export function estimatePlacementWarning(
  planningElementType: string | null | undefined,
  hasControlAccountAncestor: boolean
): string | null {
  if (planningElementType === "control_account") {
    return "Estimates usually sit on the work packages beneath a control account rather than on the control account itself. Nothing prevents it, and it counts either way — worth being deliberate about.";
  }
  if (!hasControlAccountAncestor) {
    return "Nothing above this element is a control account. The estimate will count toward the project budget, but it won't appear in the control-account rollup, which is the formal EIA-748 figure.";
  }
  return null;
}

/**
 * Which elements sit beneath a control account.
 *
 * Walks each element up to its root once. Mirrors the server's own recursion,
 * including the part that matters: the search stops at the *nearest* control
 * account, so nesting is answered the same way on both sides.
 */
export function elementsUnderAControlAccount<T extends WbsNodeLike>(
  elements: readonly T[]
): Set<string> {
  const byId = new Map(elements.map((e) => [e.wbs_id, e]));
  const covered = new Set<string>();
  for (const element of elements) {
    let current = element.parent_wbs_id ? byId.get(element.parent_wbs_id) : undefined;
    const guard = new Set<string>([element.wbs_id]);
    while (current) {
      if (current.planning_element_type === "control_account") {
        covered.add(element.wbs_id);
        break;
      }
      // A parent chain that loops back on itself would otherwise hang the
      // browser. The database forbids it; this does not assume so.
      if (guard.has(current.wbs_id)) break;
      guard.add(current.wbs_id);
      current = current.parent_wbs_id ? byId.get(current.parent_wbs_id) : undefined;
    }
  }
  return covered;
}

/**
 * Whether the time-phased budget can produce anything at all.
 *
 * The backend's budget-period query starts from WBS elements classified as
 * control accounts and joins to a control_account row. With neither, it
 * returns nothing — not an error, just an empty result, which on screen is
 * indistinguishable from "no budget". This names the actual reason.
 */
export function timePhasedAvailability<T extends WbsNodeLike>(
  elements: readonly T[],
  controlAccountWbsIds: ReadonlySet<string>
): { available: boolean; reason: string | null } {
  const classified = elements.filter((e) => e.planning_element_type === "control_account");
  if (classified.length === 0) {
    return {
      available: false,
      reason:
        "No WBS element is classified as a control account yet. The time-phased budget rolls up to control accounts, so it has nothing to report until at least one exists.",
    };
  }
  const withAccounts = classified.filter((e) => controlAccountWbsIds.has(e.wbs_id));
  if (withAccounts.length === 0) {
    return {
      available: false,
      reason:
        "Elements are classified as control accounts, but none has a control account record linking it to a responsible organization. That link is created on the RAM, and the time-phased budget needs it.",
    };
  }
  return { available: true, reason: null };
}
