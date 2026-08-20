import { describe, it, expect } from "vitest";
import {
  toNumber, formatWorkingDuration, floatStanding, hasCpmResults,
  indexDependencies, validPredecessorOptions, formatPercentComplete, formatDate,
} from "../schedule-logic";
import type { DependencyLike, TaskLike } from "../schedule-logic";

const task = (id: string, over: Partial<TaskLike> = {}): TaskLike => ({
  task_id: id,
  parent_task_id: null,
  name: `Task ${id}`,
  duration_hours: "8",
  total_float: "0",
  is_critical: false,
  early_start: "2026-03-02",
  early_finish: "2026-03-02",
  percent_complete: null,
  ...over,
});

const dep = (id: number, from: string, to: string): DependencyLike => ({
  dependency_id: id,
  predecessor_task_id: from,
  successor_task_id: to,
  dependency_type: "FS",
  lag_hours: "0",
});

describe("toNumber", () => {
  it("converts the strings the pg driver returns for numeric columns", () => {
    expect(toNumber("16.00")).toBe(16);
    expect(toNumber(24)).toBe(24);
  });

  it("distinguishes 'not reported' from zero", () => {
    expect(toNumber(null)).toBe(null);
    expect(toNumber("")).toBe(null);
    expect(toNumber(0)).toBe(0);
  });

  it("refuses nonsense rather than propagating NaN", () => {
    expect(toNumber("not a number")).toBe(null);
  });
});

describe("formatWorkingDuration", () => {
  it("shows whole working days", () => {
    expect(formatWorkingDuration("8")).toBe("1d");
    expect(formatWorkingDuration("40")).toBe("5d");
  });

  it("shows half days as days", () => {
    expect(formatWorkingDuration("4")).toBe("0.5d");
  });

  it("leaves an odd number of hours in hours rather than rounding it", () => {
    expect(formatWorkingDuration("3")).toBe("3h");
  });

  it("shows zero for a milestone, and a dash for never-set", () => {
    expect(formatWorkingDuration(0)).toBe("0");
    expect(formatWorkingDuration(null)).toBe("—");
  });
});

describe("floatStanding", () => {
  it("treats zero float as critical", () => {
    expect(floatStanding({ total_float: "0", is_critical: true })).toBe("critical");
  });

  it("treats negative float as its own case, not as critical", () => {
    // The distinction that matters: zero float means no room to slip;
    // negative float means the schedule as constrained is impossible.
    expect(floatStanding({ total_float: "-16.00", is_critical: true })).toBe("negative");
  });

  it("reports real slack", () => {
    expect(floatStanding({ total_float: "24", is_critical: false })).toBe("slack");
  });

  it("reports unknown when CPM has never run", () => {
    expect(floatStanding({ total_float: null, is_critical: false })).toBe("unknown");
  });
});

describe("hasCpmResults", () => {
  it("is false before any calculation has been run", () => {
    expect(hasCpmResults([task("a", { early_start: null }), task("b", { early_start: null })])).toBe(false);
  });

  it("is true once any task has calculated dates", () => {
    expect(hasCpmResults([task("a", { early_start: null }), task("b")])).toBe(true);
  });
});

describe("indexDependencies", () => {
  it("indexes both directions in a single pass", () => {
    const index = indexDependencies([dep(1, "a", "b"), dep(2, "b", "c"), dep(3, "a", "c")]);
    expect(index.predecessorsOf.get("c")?.map((d) => d.predecessor_task_id).sort()).toEqual(["a", "b"]);
    expect(index.successorsOf.get("a")?.map((d) => d.successor_task_id).sort()).toEqual(["b", "c"]);
    expect(index.predecessorsOf.get("a")).toBe(undefined);
  });
});

describe("validPredecessorOptions", () => {
  const tasks = [task("a"), task("b"), task("c"), task("d")];

  it("never offers the task itself", () => {
    expect(validPredecessorOptions(tasks, "a", []).map((t) => t.task_id)).toEqual(["b", "c", "d"]);
  });

  it("never offers a task that already depends on this one, directly", () => {
    // a → b already exists, so b can't also precede a.
    const options = validPredecessorOptions(tasks, "a", [dep(1, "a", "b")]).map((t) => t.task_id);
    expect(options).not.toContain("b");
  });

  it("never offers one that depends on it indirectly, three links deep", () => {
    // a → b → c → d. None of b, c or d may precede a; only the traversal
    // catches d, which is exactly the case a naive check would miss.
    const chain = [dep(1, "a", "b"), dep(2, "b", "c"), dep(3, "c", "d")];
    const options = validPredecessorOptions(tasks, "a", chain).map((t) => t.task_id);
    expect(options).toEqual([]);
  });

  it("doesn't offer a predecessor that is already linked", () => {
    const options = validPredecessorOptions(tasks, "c", [dep(1, "a", "c")]).map((t) => t.task_id);
    expect(options).not.toContain("a");
    expect(options.sort()).toEqual(["b", "d"]);
  });

  it("still offers unrelated tasks in a partly connected network", () => {
    const options = validPredecessorOptions(tasks, "d", [dep(1, "a", "b")]).map((t) => t.task_id);
    expect(options.sort()).toEqual(["a", "b", "c"]);
  });
});

describe("formatting helpers", () => {
  it("never shows an unreported percent complete as zero", () => {
    expect(formatPercentComplete(null)).toBe("—");
    expect(formatPercentComplete("0")).toBe("0%");
    expect(formatPercentComplete("42.50")).toBe("42.5%");
  });

  it("trims a timestamp to a date", () => {
    expect(formatDate("2026-03-02T00:00:00.000Z")).toBe("2026-03-02");
    expect(formatDate(null)).toBe("—");
  });
});
