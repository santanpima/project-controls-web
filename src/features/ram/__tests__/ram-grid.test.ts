import { describe, it, expect } from "vitest";
import {
  filledCellCount,
  rowControlAccount,
  rowStatus,
  indexElements,
  cellCreatability,
  missingResponsibleOrgRows,
  emptyColumns,
  coverage,
  formatBudget,
} from "../ram-grid";
import type { RamRowLike, RamColumnLike, ElementLike } from "../ram-grid";

const COLUMNS: RamColumnLike[] = [
  { obsId: "eng", orgCode: "ENG", name: "Engineering" },
  { obsId: "mfg", orgCode: "MFG", name: "Manufacturing" },
  { obsId: "qa", orgCode: "QA", name: "Quality" },
];

function row(wbsId: string, code: string, filledIn: string | null, controlAccountId = 1): RamRowLike {
  const cells: RamRowLike["cells"] = {};
  for (const c of COLUMNS) {
    cells[c.obsId] = c.obsId === filledIn ? { filled: true, controlAccountId, budget: "1000.00" } : { filled: false };
  }
  return { wbsId, code, name: `Element ${code}`, cells };
}

function validationRow(wbsId: string, isReporting: boolean, responsible: string | null): ElementLike {
  return {
    wbs_id: wbsId,
    code: wbsId,
    name: `Element ${wbsId}`,
    is_reporting_element: isReporting,
    responsible_obs_id: responsible,
  };
}

describe("rowControlAccount", () => {
  it("finds the filled cell on a row", () => {
    const found = rowControlAccount(row("w1", "1.1", "eng"));
    expect(found?.obsId).toBe("eng");
    expect(found?.cell.controlAccountId).toBe(1);
  });

  it("returns null for a row with no control account", () => {
    expect(rowControlAccount(row("w1", "1.1", null))).toBe(null);
  });
});

describe("filledCellCount", () => {
  it("counts filled cells across the whole grid", () => {
    expect(filledCellCount([row("w1", "1.1", "eng"), row("w2", "1.2", "mfg"), row("w3", "1.3", null)])).toBe(2);
  });

  it("is zero for a matrix with nothing formalised yet", () => {
    expect(filledCellCount([row("w1", "1.1", null)])).toBe(0);
  });
});

describe("rowStatus", () => {
  it("reports a healthy row with no flags", () => {
    const v = indexElements([validationRow("w1", true, "eng")]);
    const status = rowStatus(row("w1", "1.1", "eng"), v);
    expect(status.hasControlAccount).toBe(true);
    expect(status.missingResponsibleOrg).toBe(false);
    expect(status.ineligibleButHasAccount).toBe(false);
    expect(status.divergesFromResponsibleOrg).toBe(false);
  });

  it("flags a reporting element with no responsible organization", () => {
    const v = indexElements([validationRow("w1", true, null)]);
    expect(rowStatus(row("w1", "1.1", null), v).missingResponsibleOrg).toBe(true);
  });

  it("does not flag a NON-reporting element for a missing responsible org", () => {
    // The validation is deliberately scoped to eligible elements — a summary
    // node was never expected to name one.
    const v = indexElements([validationRow("w1", false, null)]);
    expect(rowStatus(row("w1", "1.1", null), v).missingResponsibleOrg).toBe(false);
  });

  it("flags an ineligible element that nonetheless holds a control account", () => {
    // This state is reachable in existing data: creating a control account
    // never checked eligibility, and is_reporting_element is editable
    // afterwards. Confirmed against a real database.
    const v = indexElements([validationRow("w1", false, null)]);
    expect(rowStatus(row("w1", "1.2", "qa"), v).ineligibleButHasAccount).toBe(true);
  });

  it("notices when the control account sits in a different column from the responsible org", () => {
    const v = indexElements([validationRow("w1", true, "eng")]);
    expect(rowStatus(row("w1", "1.1", "mfg"), v).divergesFromResponsibleOrg).toBe(true);
  });

  it("does not call it a divergence when the element names no responsible org at all", () => {
    const v = indexElements([validationRow("w1", true, null)]);
    expect(rowStatus(row("w1", "1.1", "mfg"), v).divergesFromResponsibleOrg).toBe(false);
  });

  it("treats an element missing from the validation set as eligible rather than flagging it", () => {
    // Better to under-flag than to invent a problem from absent data.
    const status = rowStatus(row("w1", "1.1", "eng"), indexElements([]));
    expect(status.ineligibleButHasAccount).toBe(false);
    expect(status.missingResponsibleOrg).toBe(false);
  });
});

describe("cellCreatability", () => {
  const v = indexElements([validationRow("w1", true, "eng")]);

  it("allows creation on an empty row for someone with permission", () => {
    const r = row("w1", "1.1", null);
    expect(cellCreatability(r, rowStatus(r, v), true).creatable).toBe(true);
  });

  it("refuses a second control account and says why", () => {
    const r = row("w1", "1.1", "eng");
    const result = cellCreatability(r, rowStatus(r, v), true);
    expect(result.creatable).toBe(false);
    expect(result.reason).toContain("only one");
  });

  it("refuses without permission, and names that as the reason", () => {
    const r = row("w1", "1.1", null);
    const result = cellCreatability(r, rowStatus(r, v), false);
    expect(result.creatable).toBe(false);
    expect(result.reason).toContain("permission");
  });

  it("still allows creation when no responsible org is set, since that flag is soft by design", () => {
    const vv = indexElements([validationRow("w1", true, null)]);
    const r = row("w1", "1.1", null);
    expect(cellCreatability(r, rowStatus(r, vv), true).creatable).toBe(true);
  });
});

describe("a control account the matrix cannot show", () => {
  // A control account whose organization sits outside the project has no column,
  // so no cell on its row is filled. Without telling rowStatus about it, the row
  // reads as empty: it offers a "+" on every column, and clicking one can only
  // ever return 409 while discarding the budget the person typed.
  const v = indexElements([validationRow("w1", true, "eng")]);

  it("counts the row as occupied even though no cell is filled", () => {
    const r = row("w1", "1.1", null);
    const status = rowStatus(r, v, new Set(["w1"]));
    expect(status.hasControlAccount).toBe(true);
    expect(status.accountOffGrid).toBe(true);
  });

  it("refuses creation on that row, with a reason naming the real cause", () => {
    const r = row("w1", "1.1", null);
    const result = cellCreatability(r, rowStatus(r, v, new Set(["w1"])), true);
    expect(result.creatable).toBe(false);
    expect(result.reason).toContain("outside this project");
  });

  it("leaves other rows alone", () => {
    const r = row("w2", "1.2", null);
    expect(rowStatus(r, v, new Set(["w1"])).hasControlAccount).toBe(false);
  });

  it("counts it in coverage rather than leaving the row looking unformalised", () => {
    const summary = coverage([row("w1", "1.1", null)], v, new Set(["w1"]));
    expect(summary.withControlAccount).toBe(1);
  });
});

describe("cellCreatability on an ineligible element", () => {
  it("refuses, matching what the server now does, instead of offering a doomed button", () => {
    const v = indexElements([validationRow("w1", false, null)]);
    const r = row("w1", "1.2", null);
    const result = cellCreatability(r, rowStatus(r, v), true);
    expect(result.creatable).toBe(false);
    expect(result.reason).toContain("reporting element");
  });
});

describe("missingResponsibleOrgRows", () => {
  it("returns only reporting elements with no responsible org", () => {
    const rows = [
      validationRow("w1", true, "eng"),
      validationRow("w2", true, null),
      validationRow("w3", false, null),
    ];
    const found = missingResponsibleOrgRows(rows);
    expect(found).toHaveLength(1);
    expect(found[0].wbs_id).toBe("w2");
  });

  it("returns nothing when every eligible element is assigned", () => {
    expect(missingResponsibleOrgRows([validationRow("w1", true, "eng")])).toHaveLength(0);
  });
});

describe("emptyColumns", () => {
  it("finds an organization that holds no control account anywhere", () => {
    const empty = emptyColumns(COLUMNS, [row("w1", "1.1", "eng")]);
    expect(empty.has("mfg")).toBe(true);
    expect(empty.has("qa")).toBe(true);
    expect(empty.has("eng")).toBe(false);
  });

  it("returns every column when nothing is formalised", () => {
    expect(emptyColumns(COLUMNS, [row("w1", "1.1", null)]).size).toBe(3);
  });

  it("returns nothing when every column carries a control account", () => {
    const rows = [row("w1", "1.1", "eng"), row("w2", "1.2", "mfg"), row("w3", "1.3", "qa")];
    expect(emptyColumns(COLUMNS, rows).size).toBe(0);
  });
});

describe("coverage", () => {
  it("counts eligible elements and how many are formalised", () => {
    const v = indexElements([validationRow("w1", true, "eng"), validationRow("w2", true, "mfg")]);
    const summary = coverage([row("w1", "1.1", "eng"), row("w2", "1.2", null)], v);
    expect(summary.reportingElements).toBe(2);
    expect(summary.withControlAccount).toBe(1);
  });

  it("keeps an ineligible element out of the denominator", () => {
    // Counting it would make the coverage figure improve every time someone
    // created a control account somewhere it doesn't belong.
    const v = indexElements([validationRow("w1", true, "eng"), validationRow("w2", false, null)]);
    const summary = coverage([row("w1", "1.1", "eng"), row("w2", "1.2", "qa")], v);
    expect(summary.reportingElements).toBe(1);
    expect(summary.withControlAccount).toBe(1);
    expect(summary.ineligibleWithAccount).toBe(1);
  });

  it("counts elements missing a responsible organization", () => {
    const v = indexElements([validationRow("w1", true, null), validationRow("w2", true, null)]);
    const summary = coverage([row("w1", "1.1", null), row("w2", "1.2", null)], v);
    expect(summary.missingResponsibleOrg).toBe(2);
  });

  it("reports an empty project without dividing by anything", () => {
    const summary = coverage([], indexElements([]));
    expect(summary.reportingElements).toBe(0);
    expect(summary.withControlAccount).toBe(0);
  });
});

describe("formatBudget", () => {
  it("formats in the project's currency", () => {
    expect(formatBudget("1000.00", "USD")).toContain("1,000");
  });

  it("shows a dash for a budget that isn't there, never a zero", () => {
    expect(formatBudget(null, "USD")).toBe("—");
    expect(formatBudget(undefined, "USD")).toBe("—");
  });

  it("shows a genuine zero budget as zero rather than as absent", () => {
    expect(formatBudget("0.00", "USD")).toContain("0");
  });

  it("falls back to plain digits rather than guessing a symbol", () => {
    expect(formatBudget("1234", "NOT_A_CURRENCY")).toContain("1,234");
  });

  it("refuses nonsense rather than rendering NaN", () => {
    expect(formatBudget("abc", "USD")).toBe("—");
  });
});
