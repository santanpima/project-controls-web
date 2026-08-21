import { describe, it, expect } from "vitest";
import {
  toNumber,
  estimateValue,
  sumEstimates,
  estimatesByWbsId,
  rollUpBudget,
  projectTotal,
  phaseByPeriod,
  formatMoney,
  describeTotal,
  estimatePlacementWarning,
  elementsUnderAControlAccount,
  timePhasedAvailability,
} from "../budget-rollup";
import type { EstimateLike, WbsNodeLike } from "../budget-rollup";

// A small control account with two work packages beneath it, which is the
// shape every EVM figure in this module is computed against.
const WBS: WbsNodeLike[] = [
  { wbs_id: "w1", parent_wbs_id: null, code: "1", name: "Program", planning_element_type: null },
  { wbs_id: "w2", parent_wbs_id: "w1", code: "1.1", name: "Engineering", planning_element_type: "control_account" },
  { wbs_id: "w3", parent_wbs_id: "w2", code: "1.1.1", name: "Design", planning_element_type: "work_package" },
  { wbs_id: "w4", parent_wbs_id: "w2", code: "1.1.2", name: "Analysis", planning_element_type: "work_package" },
];

function est(id: number, wbsId: string, base: string | number, rate: string | number | null, period: string | null = null): EstimateLike {
  return { estimate_id: id, wbs_id: wbsId, base_value: base, rate, fiscal_period_id: period };
}

describe("toNumber", () => {
  it("parses the strings the pg driver returns for NUMERIC columns", () => {
    expect(toNumber("120.0000")).toBe(120);
    expect(toNumber("500.00")).toBe(500);
  });

  it("treats a missing rate as unknown, never as zero", () => {
    expect(toNumber(null)).toBe(null);
    expect(toNumber(undefined)).toBe(null);
    expect(toNumber("")).toBe(null);
  });

  it("refuses nonsense rather than letting NaN into a sum", () => {
    expect(toNumber("not a number")).toBe(null);
  });
});

describe("estimateValue", () => {
  it("multiplies quantity by rate", () => {
    expect(estimateValue(est(1, "w3", "500.00", "120.0000"))).toBe(60000);
  });

  it("returns null — not zero — when there is no rate", () => {
    expect(estimateValue(est(1, "w3", "500.00", null))).toBe(null);
  });

  it("returns null when the quantity itself is unreadable", () => {
    expect(estimateValue(est(1, "w3", "oops", "10"))).toBe(null);
  });

  it("handles a rate of genuinely zero, which is different from no rate", () => {
    expect(estimateValue(est(1, "w3", "500", "0"))).toBe(0);
  });
});

describe("sumEstimates", () => {
  it("adds up the rated estimates", () => {
    const total = sumEstimates([est(1, "w3", 100, 10), est(2, "w3", 200, 5)]);
    expect(total.value).toBe(2000);
    expect(total.estimateCount).toBe(2);
    expect(total.unratedCount).toBe(0);
  });

  it("counts unrated estimates separately instead of adding them as zero", () => {
    const total = sumEstimates([est(1, "w3", 100, 10), est(2, "w3", 500, null)]);
    expect(total.value).toBe(1000);
    expect(total.estimateCount).toBe(2);
    expect(total.unratedCount).toBe(1);
  });

  it("reports an empty set as empty, not as zero money", () => {
    const total = sumEstimates([]);
    expect(total.estimateCount).toBe(0);
    expect(total.value).toBe(0);
  });
});

describe("estimatesByWbsId", () => {
  it("groups estimates under the element they belong to", () => {
    const grouped = estimatesByWbsId([est(1, "w3", 1, 1), est(2, "w4", 1, 1), est(3, "w3", 1, 1)], new Set(["w3", "w4"]));
    expect(grouped.get("w3")).toHaveLength(2);
    expect(grouped.get("w4")).toHaveLength(1);
  });

  it("drops estimates belonging to an element that isn't in the tree", () => {
    // A soft-deleted WBS element: counting its estimates would overstate the
    // budget against a tree that no longer contains the work.
    const grouped = estimatesByWbsId([est(1, "w3", 1, 1), est(2, "gone", 999, 999)], new Set(["w3"]));
    expect(grouped.has("gone")).toBe(false);
    expect(grouped.size).toBe(1);
  });
});

describe("rollUpBudget", () => {
  const estimates = [
    est(1, "w3", "500.00", "120.0000"), // 60,000 on Design
    est(2, "w4", "200.00", "95.0000"), // 19,000 on Analysis
  ];

  it("gives a work package its own figure", () => {
    const { direct } = rollUpBudget(WBS, estimates);
    expect(direct.get("w3")?.value).toBe(60000);
    expect(direct.get("w4")?.value).toBe(19000);
  });

  it("gives a control account nothing directly, because the estimates sit below it", () => {
    const { direct } = rollUpBudget(WBS, estimates);
    expect(direct.get("w2")?.value).toBe(0);
    expect(direct.get("w2")?.estimateCount).toBe(0);
  });

  it("rolls both work packages up into the control account's subtree", () => {
    const { subtree } = rollUpBudget(WBS, estimates);
    expect(subtree.get("w2")?.value).toBe(79000);
    expect(subtree.get("w2")?.estimateCount).toBe(2);
  });

  it("carries the rollup all the way to the root", () => {
    const { subtree } = rollUpBudget(WBS, estimates);
    expect(subtree.get("w1")?.value).toBe(79000);
  });

  it("leaves a leaf's subtree equal to its own figure", () => {
    const { direct, subtree } = rollUpBudget(WBS, estimates);
    expect(subtree.get("w3")?.value).toBe(direct.get("w3")?.value);
  });

  it("propagates the unrated count upward, so a summary node admits what it's missing", () => {
    const { subtree } = rollUpBudget(WBS, [est(1, "w3", 500, 120), est(2, "w4", 800, null)]);
    expect(subtree.get("w2")?.value).toBe(60000);
    expect(subtree.get("w2")?.unratedCount).toBe(1);
    expect(subtree.get("w2")?.estimateCount).toBe(2);
  });

  it("gives every element an entry even when nothing is estimated anywhere", () => {
    const { direct, subtree } = rollUpBudget(WBS, []);
    expect(direct.get("w4")?.estimateCount).toBe(0);
    expect(subtree.get("w1")?.value).toBe(0);
  });
});

describe("projectTotal", () => {
  it("adds the roots together", () => {
    const estimates = [est(1, "w3", 500, 120), est(2, "w4", 200, 95)];
    expect(projectTotal(WBS, rollUpBudget(WBS, estimates)).value).toBe(79000);
  });

  it("counts an orphaned element once, not twice", () => {
    // An element whose parent is missing is promoted to a root by the shared
    // tree logic. It must still be counted exactly once.
    const orphaned: WbsNodeLike[] = [
      ...WBS,
      { wbs_id: "w9", parent_wbs_id: "missing", code: "9", name: "Orphan", planning_element_type: "work_package" },
    ];
    const estimates = [est(1, "w3", 500, 120), est(9, "w9", 10, 10)];
    expect(projectTotal(orphaned, rollUpBudget(orphaned, estimates)).value).toBe(60100);
  });
});

describe("phaseByPeriod", () => {
  const periods = [
    { fiscal_period_id: "p1", period_number: 1, start_date: "2026-01-01", end_date: "2026-01-31" },
    { fiscal_period_id: "p2", period_number: 2, start_date: "2026-02-01", end_date: "2026-02-28" },
    { fiscal_period_id: "p3", period_number: 3, start_date: "2026-03-01", end_date: "2026-03-31" },
  ];

  it("produces one column per period that actually carries estimates", () => {
    const columns = phaseByPeriod([est(1, "w3", 100, 10, "p1"), est(2, "w3", 200, 10, "p3")], periods);
    expect(columns).toHaveLength(2);
    expect(columns[0].fiscalPeriodId).toBe("p1");
    expect(columns[1].fiscalPeriodId).toBe("p3");
  });

  it("omits empty periods rather than printing a wall of blank columns", () => {
    const columns = phaseByPeriod([est(1, "w3", 100, 10, "p2")], periods);
    expect(columns).toHaveLength(1);
    expect(columns[0].label).toContain("P2");
  });

  it("keeps periods in calendar order, not in the order estimates arrived", () => {
    const columns = phaseByPeriod([est(1, "w3", 1, 1, "p3"), est(2, "w3", 1, 1, "p1")], periods);
    expect(columns[0].fiscalPeriodId).toBe("p1");
  });

  it("shows unphased estimates in their own column instead of dropping them", () => {
    const columns = phaseByPeriod([est(1, "w3", 100, 10, "p1"), est(2, "w3", 50, 10, null)], periods);
    const unphased = columns.find((c) => c.fiscalPeriodId === null);
    expect(unphased?.total.value).toBe(500);
    expect(unphased?.label).toBe("No period");
  });

  it("puts the unphased column last, after the real periods", () => {
    const columns = phaseByPeriod([est(1, "w3", 1, 1, null), est(2, "w3", 1, 1, "p1")], periods);
    expect(columns[columns.length - 1].fiscalPeriodId).toBe(null);
  });

  it("surfaces an estimate pointing at a period this calendar doesn't have", () => {
    // Happens when a project is reassigned to a different calendar after
    // estimates were tagged. Silently dropping it would make the time-phased
    // table disagree with the tree beside it.
    const columns = phaseByPeriod([est(1, "w3", 100, 10, "from-another-calendar")], periods);
    expect(columns).toHaveLength(1);
    expect(columns[0].label).toBe("Unknown period");
    expect(columns[0].total.value).toBe(1000);
  });

  it("phases the unrated count too, not just the money", () => {
    const columns = phaseByPeriod([est(1, "w3", 100, null, "p1")], periods);
    expect(columns[0].total.unratedCount).toBe(1);
    expect(columns[0].total.value).toBe(0);
  });
});

describe("formatMoney", () => {
  it("formats in the project's currency", () => {
    expect(formatMoney(60000, "USD")).toContain("60,000");
  });

  it("falls back to plain digits rather than guessing a symbol", () => {
    // A wrong currency symbol on a cost figure is worse than none at all.
    expect(formatMoney(1234, "NOT_A_CURRENCY")).toContain("1,234");
  });

  it("copes with no currency set on the project at all", () => {
    expect(formatMoney(1234, null)).toContain("1,234");
  });
});

describe("describeTotal", () => {
  it("shows a dash when nothing has been estimated, never a costed-looking zero", () => {
    expect(describeTotal({ value: 0, estimateCount: 0, unratedCount: 0 }, "USD").text).toBe("—");
  });

  it("shows the money with no caveat when everything is rated", () => {
    const described = describeTotal({ value: 60000, estimateCount: 2, unratedCount: 0 }, "USD");
    expect(described.text).toContain("60,000");
    expect(described.caveat).toBe(null);
  });

  it("says plainly when some estimates add nothing", () => {
    const described = describeTotal({ value: 60000, estimateCount: 3, unratedCount: 1 }, "USD");
    expect(described.caveat).toContain("no rate");
  });

  it("distinguishes 'nothing estimated' from 'estimated but never costed'", () => {
    const described = describeTotal({ value: 0, estimateCount: 2, unratedCount: 2 }, "USD");
    expect(described.text).not.toBe("—");
    expect(described.caveat).toContain("nothing is costed yet");
  });
});

describe("estimatePlacementWarning", () => {
  it("says nothing about a work package beneath a control account", () => {
    expect(estimatePlacementWarning("work_package", true)).toBe(null);
    expect(estimatePlacementWarning("planning_package", true)).toBe(null);
  });

  it("warns about a control account without refusing it", () => {
    expect(estimatePlacementWarning("control_account", false)).toContain("beneath a control account");
  });

  it("stays silent about an unclassified element that IS under a control account", () => {
    // The correction: the server's rollup recurses into every descendant
    // regardless of classification, so this placement genuinely works. The
    // earlier version of this function warned against it.
    expect(estimatePlacementWarning(null, true)).toBe(null);
  });

  it("warns only when nothing above the element is a control account", () => {
    expect(estimatePlacementWarning(null, false)).toContain("control-account rollup");
  });
});

describe("elementsUnderAControlAccount", () => {
  it("finds the work packages beneath a control account", () => {
    const covered = elementsUnderAControlAccount(WBS);
    expect(covered.has("w3")).toBe(true);
    expect(covered.has("w4")).toBe(true);
  });

  it("does not count the control account as being under itself", () => {
    expect(elementsUnderAControlAccount(WBS).has("w2")).toBe(false);
  });

  it("excludes an element with no control account anywhere above it", () => {
    expect(elementsUnderAControlAccount(WBS).has("w1")).toBe(false);
  });

  it("finds a control account several levels up, not just the immediate parent", () => {
    const deep: WbsNodeLike[] = [
      ...WBS,
      { wbs_id: "w5", parent_wbs_id: "w3", code: "1.1.1.1", name: "Deep", planning_element_type: null },
      { wbs_id: "w6", parent_wbs_id: "w5", code: "1.1.1.1.1", name: "Deeper", planning_element_type: null },
    ];
    expect(elementsUnderAControlAccount(deep).has("w6")).toBe(true);
  });

  it("terminates on a parent chain that loops rather than hanging", () => {
    const looped: WbsNodeLike[] = [
      { wbs_id: "a", parent_wbs_id: "b", code: "1", name: "A", planning_element_type: null },
      { wbs_id: "b", parent_wbs_id: "a", code: "2", name: "B", planning_element_type: null },
    ];
    expect(elementsUnderAControlAccount(looped).size).toBe(0);
  });
});

describe("timePhasedAvailability", () => {
  it("names the missing classification rather than showing an empty table", () => {
    const unclassified = WBS.map((e) => ({ ...e, planning_element_type: null }));
    const result = timePhasedAvailability(unclassified, new Set());
    expect(result.available).toBe(false);
    expect(result.reason).toContain("control account");
  });

  it("distinguishes 'classified but not linked' from 'not classified'", () => {
    const result = timePhasedAvailability(WBS, new Set());
    expect(result.available).toBe(false);
    expect(result.reason).toContain("responsible organization");
  });

  it("reports availability once a classified element has its control account record", () => {
    const result = timePhasedAvailability(WBS, new Set(["w2"]));
    expect(result.available).toBe(true);
    expect(result.reason).toBe(null);
  });
});
