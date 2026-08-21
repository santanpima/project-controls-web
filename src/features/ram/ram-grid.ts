// The logic behind the Responsibility Assignment Matrix screen, kept pure so it
// can be tested without a browser or a server.
//
// The server already assembles the grid's shape. What it does not do — and what
// this module exists for — is answer the questions a person looking at the
// matrix actually has: which rows are incomplete and why, whether a cell can be
// acted on, and whether what is on screen is the whole truth.
//
// That last one is the reason several of these functions exist at all. The
// matrix can be structurally incapable of showing a control account that really
// exists: its columns are project-scoped, and a control account pointing at
// another project's organization has no column to sit in. A grid that quietly
// omitted those would be a confident-looking lie, so they are surfaced as
// anomalies instead.

export interface RamCellLike {
  filled: boolean;
  controlAccountId?: number;
  budget?: string | number;
}

export interface RamRowLike {
  wbsId: string;
  code: string;
  name: string;
  cells: Record<string, RamCellLike>;
}

export interface RamColumnLike {
  obsId: string;
  orgCode: string;
  name: string;
}

// The WBS element behind a grid row.
//
// This deliberately comes from the WBS list endpoint, not from /ram/validation.
// That distinction was a real error in the first version of this module and it
// silently disabled half the screen: /ram/validation returns only the elements
// that FAIL the check — reporting elements with no responsible organization —
// not every element with its flags. Indexing it and reading `responsible_obs_id`
// out of it therefore returned null for every element that had one, so the
// divergence flag could never fire, the "not eligible" badge could never
// appear, and the coverage figure counted ineligible rows into its own
// denominator. Nothing errored; the flags were simply always false.
export interface ElementLike {
  wbs_id: string;
  code: string;
  name: string;
  is_reporting_element: boolean;
  responsible_obs_id: string | null;
  planning_element_type?: string | null;
}

/** Which WBS element each column's filled cell sits on, if any. */
export function filledCellCount(rows: readonly RamRowLike[]): number {
  let count = 0;
  for (const row of rows) {
    for (const cell of Object.values(row.cells)) {
      if (cell.filled) count += 1;
    }
  }
  return count;
}

/**
 * The single filled cell on a row, if there is one.
 *
 * "If there is one" rather than "the filled cells" is deliberate and load
 * bearing: a WBS element can hold at most one control account, enforced by a
 * unique constraint on the database, which is exactly what makes "this cell is
 * filled" mean something precise. A row with two filled cells would mean that
 * constraint had been lost.
 */
export function rowControlAccount(row: RamRowLike): { obsId: string; cell: RamCellLike } | null {
  for (const [obsId, cell] of Object.entries(row.cells)) {
    if (cell.filled) return { obsId, cell };
  }
  return null;
}

export interface RowStatus {
  hasControlAccount: boolean;
  /** It has one, but the matrix has no column able to show it. */
  accountOffGrid: boolean;
  /** Marked as a reporting element, so eligible for a control account. */
  isEligible: boolean;
  /** The organization the WBS element names as responsible, if any. */
  responsibleObsId: string | null;
  /** A reporting element with no responsible organization — 8.3.1.1.3's soft flag. */
  missingResponsibleOrg: boolean;
  /** Holds a control account despite not being marked eligible for one. */
  ineligibleButHasAccount: boolean;
  /**
   * The control account sits in a different column from the organization the
   * WBS element names as responsible. Not an error — a control account's
   * organization is directly reassignable and the two fields are genuinely
   * independent — but a divergence worth seeing rather than guessing at.
   */
  divergesFromResponsibleOrg: boolean;
}

export function rowStatus(
  row: RamRowLike,
  elements: ReadonlyMap<string, ElementLike>,
  // WBS elements whose control account points at an organization outside this
  // project. They have no column, so no cell on their row is filled — and
  // without this the row read as having no control account at all, offering a
  // "+" on every column that could only ever answer 409.
  offGridAccountWbsIds: ReadonlySet<string> = new Set()
): RowStatus {
  const account = rowControlAccount(row);
  const offGrid = offGridAccountWbsIds.has(row.wbsId);
  const element = elements.get(row.wbsId);
  const responsibleObsId = element?.responsible_obs_id ?? null;
  const isReporting = element?.is_reporting_element ?? true;

  return {
    hasControlAccount: account !== null || offGrid,
    accountOffGrid: offGrid,
    isEligible: isReporting,
    responsibleObsId,
    // Only flagged when the element's own record is actually in hand. Without
    // it, "no responsible organization" is indistinguishable from "we never
    // looked" — and asserting a problem from absent data is worse than staying
    // quiet, because the flag is what tells someone to go and fix something.
    missingResponsibleOrg: element !== undefined && isReporting && !responsibleObsId,
    ineligibleButHasAccount: !isReporting && (account !== null || offGrid),
    divergesFromResponsibleOrg:
      account !== null && responsibleObsId !== null && account.obsId !== responsibleObsId,
  };
}

export function indexElements(rows: readonly ElementLike[]): Map<string, ElementLike> {
  return new Map(rows.map((r) => [r.wbs_id, r]));
}

/**
 * Whether an empty cell can be turned into a control account.
 *
 * Three separate reasons it might not be, each with its own explanation,
 * because "the cell doesn't respond" is the worst possible way to communicate
 * any of them:
 *
 * - the element already has a control account in another column, and the unique
 *   constraint permits only one;
 * - the element isn't marked as a reporting element, so it isn't eligible;
 * - the person lacks permission to create one.
 */
export function cellCreatability(
  row: RamRowLike,
  status: RowStatus,
  canCreate: boolean
): { creatable: boolean; reason: string | null } {
  if (!canCreate) {
    return { creatable: false, reason: "You don't have permission to create control accounts." };
  }
  if (status.accountOffGrid) {
    return {
      creatable: false,
      reason: `${row.code} already has a control account, assigned to an organization outside this project — so it has no column here. Reassign it rather than trying to create a second.`,
    };
  }
  if (status.hasControlAccount) {
    return {
      creatable: false,
      reason: `${row.code} already has a control account. A WBS element can hold only one — reassign it instead of creating a second.`,
    };
  }
  // Reaching here means the row has no control account, so ineligibility is the
  // only remaining refusal.
  if (!status.isEligible) {
    return {
      creatable: false,
      reason: `${row.code} isn't marked as a reporting element, so it isn't eligible for a control account. Mark it as one on the WBS screen first — the server refuses this too.`,
    };
  }
  // A missing responsible organization is deliberately NOT a refusal:
  // responsible_obs_id is nullable by design and 8.3.1.1.3 made that flag soft.
  // Blocking here would re-litigate a decision this screen isn't positioned to
  // reopen.
  return { creatable: true, reason: null };
}

/** Reporting elements with no responsible organization, in code order. */
export function missingResponsibleOrgRows<T extends ElementLike>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.is_reporting_element && !r.responsible_obs_id);
}

/**
 * A column with no filled cell anywhere.
 *
 * Worth surfacing rather than hiding: the server includes an organization as a
 * column when it is responsible for at least one element *or* holds a control
 * account. An organization that is responsible for work but holds no control
 * account produces an entirely empty column, which is a real and meaningful
 * state — it says that responsibility has been assigned but never formalised
 * into a control account.
 */
export function emptyColumns(
  columns: readonly RamColumnLike[],
  rows: readonly RamRowLike[]
): Set<string> {
  const used = new Set<string>();
  for (const row of rows) {
    for (const [obsId, cell] of Object.entries(row.cells)) {
      if (cell.filled) used.add(obsId);
    }
  }
  return new Set(columns.filter((c) => !used.has(c.obsId)).map((c) => c.obsId));
}

export interface CoverageSummary {
  reportingElements: number;
  withControlAccount: number;
  missingResponsibleOrg: number;
  ineligibleWithAccount: number;
}

/**
 * How complete the matrix is.
 *
 * `reportingElements` counts only the eligible rows, not every row on screen:
 * a row that is present solely because it holds a control account it should
 * never have had is not part of the denominator for "how much of the eligible
 * work has been formalised". Counting it would make the coverage figure improve
 * whenever a mistake was made.
 */
export function coverage(
  rows: readonly RamRowLike[],
  elements: ReadonlyMap<string, ElementLike>,
  offGridAccountWbsIds: ReadonlySet<string> = new Set()
): CoverageSummary {
  let reportingElements = 0;
  let withControlAccount = 0;
  let missingResponsibleOrg = 0;
  let ineligibleWithAccount = 0;

  for (const row of rows) {
    const status = rowStatus(row, elements, offGridAccountWbsIds);
    const isReporting = status.isEligible;

    if (isReporting) {
      reportingElements += 1;
      if (status.hasControlAccount) withControlAccount += 1;
    } else if (status.hasControlAccount) {
      ineligibleWithAccount += 1;
    }
    if (status.missingResponsibleOrg) missingResponsibleOrg += 1;
  }

  return { reportingElements, withControlAccount, missingResponsibleOrg, ineligibleWithAccount };
}

/** Money for the project's own currency, with an honest fallback. */
export function formatBudget(value: string | number | null | undefined, currencyCode: string | null): string {
  if (value === null || value === undefined || value === "") return "—";
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return "—";
  if (currencyCode) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode,
        maximumFractionDigits: 0,
      }).format(parsed);
    } catch {
      // fall through — a wrong currency symbol on a budget is worse than none
    }
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(parsed);
}
