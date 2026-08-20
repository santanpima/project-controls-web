import { describe, it, expect } from "vitest";
import {
  parseDate, addDays, daysBetween, computeBounds, xForDate, timelineWidth,
  barGeometry, progressWidth, generateTicks, anchorPoints, dependencyPath,
  PIXELS_PER_DAY, ROW_HEIGHT,
} from "../gantt-scale";

const bar = (start: string | null, finish: string | null) => ({ early_start: start, early_finish: finish });

describe("date helpers", () => {
  it("reads a date as UTC, not local time", () => {
    // The bug this prevents: parsed as local time, this is the 1st or the 2nd
    // depending on the viewer's timezone, and every bar shifts a day for half
    // the world.
    expect(parseDate("2026-03-02").getUTCDate()).toBe(2);
    expect(parseDate("2026-03-02T23:59:59Z").getUTCDate()).toBe(2);
  });

  it("adds days across a month boundary", () => {
    expect(addDays("2026-03-30", 3)).toBe("2026-04-02");
    expect(addDays("2026-03-02", -3)).toBe("2026-02-27");
  });

  it("handles a leap day correctly", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });

  it("counts days in both directions", () => {
    expect(daysBetween("2026-03-02", "2026-03-09")).toBe(7);
    expect(daysBetween("2026-03-09", "2026-03-02")).toBe(-7);
    expect(daysBetween("2026-03-02", "2026-03-02")).toBe(0);
  });
});

describe("computeBounds", () => {
  it("spans the earliest start to the latest finish, with padding", () => {
    const bounds = computeBounds([bar("2026-03-02", "2026-03-06"), bar("2026-03-09", "2026-03-20")], 2);
    expect(bounds).toEqual({ start: "2026-02-28", end: "2026-03-22", days: 23 });
  });

  it("returns null when nothing has been calculated", () => {
    expect(computeBounds([bar(null, null), bar(null, null)])).toBe(null);
  });

  it("ignores uncalculated tasks but keeps the calculated ones", () => {
    const bounds = computeBounds([bar(null, null), bar("2026-03-02", "2026-03-03")], 0);
    expect(bounds?.start).toBe("2026-03-02");
    expect(bounds?.end).toBe("2026-03-03");
  });

  it("copes with a task that has a start but no finish", () => {
    // A milestone the engine resolved to a single day.
    const bounds = computeBounds([bar("2026-03-02", null)], 0);
    expect(bounds).toEqual({ start: "2026-03-02", end: "2026-03-02", days: 1 });
  });
});

describe("positioning", () => {
  const bounds = { start: "2026-03-01", end: "2026-03-31", days: 31 };

  it("places a date at the right offset for the zoom level", () => {
    expect(xForDate("2026-03-01", bounds, "week")).toBe(0);
    expect(xForDate("2026-03-08", bounds, "week")).toBe(7 * PIXELS_PER_DAY.week);
    expect(xForDate("2026-03-08", bounds, "month")).toBe(7 * PIXELS_PER_DAY.month);
  });

  it("sizes the whole timeline from its day count", () => {
    expect(timelineWidth(bounds, "week")).toBe(31 * PIXELS_PER_DAY.week);
  });
});

describe("barGeometry", () => {
  const bounds = { start: "2026-03-01", end: "2026-03-31", days: 31 };

  it("makes a one-day task one day wide, not zero", () => {
    const geometry = barGeometry(bar("2026-03-02", "2026-03-02"), bounds, "week");
    expect(geometry).toEqual({ x: PIXELS_PER_DAY.week, width: PIXELS_PER_DAY.week, isPoint: true });
  });

  it("spans start to finish inclusive", () => {
    // 2nd to 6th is five days of work, so five days wide.
    const geometry = barGeometry(bar("2026-03-02", "2026-03-06"), bounds, "week");
    expect(geometry?.width).toBe(5 * PIXELS_PER_DAY.week);
    expect(geometry?.isPoint).toBe(false);
  });

  it("returns null for a task that was never calculated", () => {
    expect(barGeometry(bar(null, null), bounds, "week")).toBe(null);
  });

  it("treats a missing finish as a single-day point", () => {
    expect(barGeometry(bar("2026-03-02", null), bounds, "week")?.isPoint).toBe(true);
  });
});

describe("progressWidth", () => {
  it("fills the reported fraction of the bar", () => {
    expect(progressWidth("50", 200)).toBe(100);
    expect(progressWidth(25, 200)).toBe(50);
  });

  it("draws nothing when progress was never reported", () => {
    // Distinct from 0%, which is a real assessment and draws an empty fill.
    expect(progressWidth(null, 200)).toBe(null);
    expect(progressWidth("", 200)).toBe(null);
    expect(progressWidth("0", 200)).toBe(0);
  });

  it("clamps a nonsensical percentage rather than overflowing the bar", () => {
    expect(progressWidth("140", 200)).toBe(200);
    expect(progressWidth("-20", 200)).toBe(0);
  });
});

describe("generateTicks", () => {
  it("ticks Mondays at week zoom, never before the timeline starts", () => {
    // 2026-03-01 is a Sunday, so the first Monday is the 2nd.
    const ticks = generateTicks({ start: "2026-03-01", end: "2026-03-20", days: 20 }, "week");
    expect(ticks.map((t) => t.date)).toEqual(["2026-03-02", "2026-03-09", "2026-03-16"]);
    expect(ticks[0].label).toBe("Mar 2");
    expect(ticks[0].x).toBe(PIXELS_PER_DAY.week);
  });

  it("ticks the first of each month at month zoom", () => {
    const ticks = generateTicks({ start: "2026-02-15", end: "2026-05-02", days: 77 }, "month");
    expect(ticks.map((t) => t.date)).toEqual(["2026-03-01", "2026-04-01", "2026-05-01"]);
    expect(ticks[0].label).toBe("Mar 2026");
  });

  it("crosses a year boundary correctly", () => {
    const ticks = generateTicks({ start: "2026-11-20", end: "2027-02-05", days: 78 }, "month");
    expect(ticks.map((t) => t.label)).toEqual(["Dec 2026", "Jan 2027", "Feb 2027"]);
  });
});

describe("anchorPoints", () => {
  const from = { x: 100, y: 0, width: 60, isPoint: false };
  const to = { x: 300, y: 0, width: 40, isPoint: false };

  it("leaves the predecessor's finish and meets the successor's start for FS", () => {
    const { start, end } = anchorPoints("FS", from, to, 0, 1);
    expect(start.x).toBe(160); // 100 + 60
    expect(end.x).toBe(300);
  });

  it("leaves the predecessor's START for SS — the case a naive chart draws backwards", () => {
    const { start, end } = anchorPoints("SS", from, to, 0, 1);
    expect(start.x).toBe(100);
    expect(end.x).toBe(300);
  });

  it("meets the successor's finish for FF", () => {
    const { start, end } = anchorPoints("FF", from, to, 0, 1);
    expect(start.x).toBe(160);
    expect(end.x).toBe(340); // 300 + 40
  });

  it("uses both opposite ends for SF", () => {
    const { start, end } = anchorPoints("SF", from, to, 0, 1);
    expect(start.x).toBe(100);
    expect(end.x).toBe(340);
  });

  it("centres vertically on each task's own row", () => {
    const { start, end } = anchorPoints("FS", from, to, 0, 2);
    expect(start.y).toBe(ROW_HEIGHT / 2);
    expect(end.y).toBe(2 * ROW_HEIGHT + ROW_HEIGHT / 2);
  });
});

describe("dependencyPath", () => {
  it("routes forward with right angles when there's room", () => {
    const path = dependencyPath({ x: 100, y: 16 }, { x: 200, y: 48 }, 8);
    expect(path).toBe("100,16 192,16 192,48 200,48");
  });

  it("steps around when the successor starts left of the predecessor's anchor", () => {
    // Normal for SS links and for negative lag: a straight line here would cut
    // diagonally across unrelated rows.
    const path = dependencyPath({ x: 200, y: 16 }, { x: 120, y: 48 }, 8);
    expect(path).toBe("200,16 208,16 208,32 112,32 112,48 120,48");
  });

  it("rounds to whole pixels so the SVG stays crisp", () => {
    expect(dependencyPath({ x: 10.4, y: 16.6 }, { x: 100.2, y: 48.5 }, 8)).toContain("10,17");
  });
});
