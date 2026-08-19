import { describe, it, expect } from "vitest";
import { resolveRecurrence, resolveDay, resolveMonth } from "../day-resolution";
import type { CalendarCore, WorkPatternDay, RecurringRule, OneTimeException } from "../day-resolution";

// Standard Mon-Fri work week, anchored on a known Monday.
const calendar: CalendarCore = { cycle_anchor_date: "2026-01-05", work_pattern_cycle_days: 7 };
const monFriPattern: WorkPatternDay[] = [
  { day_offset: 0, is_working_day: true, hours: 8, start_time: null, end_time: null },
  { day_offset: 1, is_working_day: true, hours: 8, start_time: null, end_time: null },
  { day_offset: 2, is_working_day: true, hours: 8, start_time: null, end_time: null },
  { day_offset: 3, is_working_day: true, hours: 8, start_time: null, end_time: null },
  { day_offset: 4, is_working_day: true, hours: 8, start_time: null, end_time: null },
  { day_offset: 5, is_working_day: false, hours: 0, start_time: null, end_time: null },
  { day_offset: 6, is_working_day: false, hours: 0, start_time: null, end_time: null },
];

describe("resolveRecurrence", () => {
  it("resolves Thanksgiving 2026 (4th Thursday of November) correctly", () => {
    const rule: RecurringRule = {
      recurrence_pattern: "nth_weekday", month: 11, week_ordinal: "4th", day_of_week: "Thursday",
      is_working_day: false, name: "Thanksgiving",
    };
    expect(resolveRecurrence(rule, 2026)).toBe("2026-11-26");
  });

  it("resolves Memorial Day 2026 (last Monday of May) correctly", () => {
    const rule: RecurringRule = {
      recurrence_pattern: "nth_weekday", month: 5, week_ordinal: "last", day_of_week: "Monday",
      is_working_day: false, name: "Memorial Day",
    };
    expect(resolveRecurrence(rule, 2026)).toBe("2026-05-25");
  });

  it("resolves a fixed-date rule (July 4th) regardless of year", () => {
    const rule: RecurringRule = {
      recurrence_pattern: "fixed_date", month: 7, day: 4, is_working_day: false, name: "Independence Day",
    };
    expect(resolveRecurrence(rule, 2026)).toBe("2026-07-04");
    expect(resolveRecurrence(rule, 2027)).toBe("2027-07-04");
  });

  it("returns null for an nth-weekday occurrence that doesn't exist that month/year", () => {
    const rule: RecurringRule = {
      recurrence_pattern: "nth_weekday", month: 2, week_ordinal: "5th", day_of_week: "Friday",
      is_working_day: false, name: "Nonexistent",
    };
    expect(resolveRecurrence(rule, 2026)).toBeNull();
  });
});

describe("resolveDay precedence", () => {
  it("resolves a plain Tuesday as working, via the base pattern", () => {
    const r = resolveDay("2026-01-06", calendar, monFriPattern, [], []);
    expect(r.isWorkingDay).toBe(true);
    expect(r.source).toBe("pattern");
  });

  it("resolves a plain Saturday as non-working, via the base pattern", () => {
    const r = resolveDay("2026-01-10", calendar, monFriPattern, [], []);
    expect(r.isWorkingDay).toBe(false);
    expect(r.source).toBe("pattern");
  });

  it("a one-time exception overrides the base pattern", () => {
    const exceptions: OneTimeException[] = [
      { exception_date: "2026-01-06", is_working_day: false, name: "Office closure" },
    ];
    const r = resolveDay("2026-01-06", calendar, monFriPattern, exceptions, []);
    expect(r.isWorkingDay).toBe(false);
    expect(r.source).toBe("exception");
    expect(r.label).toBe("Office closure");
  });

  it("a recurring exception (Thanksgiving) overrides the base pattern", () => {
    const rules: RecurringRule[] = [{
      recurrence_pattern: "nth_weekday", month: 11, week_ordinal: "4th", day_of_week: "Thursday",
      is_working_day: false, name: "Thanksgiving",
    }];
    const r = resolveDay("2026-11-26", calendar, monFriPattern, [], rules);
    expect(r.isWorkingDay).toBe(false);
    expect(r.label).toBe("Thanksgiving");
  });

  it("a one-time exception takes precedence over a recurring rule matching the same date", () => {
    const exceptions: OneTimeException[] = [
      { exception_date: "2026-11-26", is_working_day: true, name: "Special override" },
    ];
    const rules: RecurringRule[] = [{
      recurrence_pattern: "nth_weekday", month: 11, week_ordinal: "4th", day_of_week: "Thursday",
      is_working_day: false, name: "Thanksgiving",
    }];
    const r = resolveDay("2026-11-26", calendar, monFriPattern, exceptions, rules);
    expect(r.isWorkingDay).toBe(true);
    expect(r.label).toBe("Special override");
  });
});

describe("resolveMonth", () => {
  it("resolves every day in the month, with the correct count for that month", () => {
    const results = resolveMonth(2026, 2, calendar, monFriPattern, [], []); // February 2026, not a leap year
    expect(results).toHaveLength(28);
    expect(results[0].date).toBe("2026-02-01");
    expect(results[27].date).toBe("2026-02-28");
  });

  it("correctly marks the one Thanksgiving Thursday as non-working within a full November", () => {
    const rules: RecurringRule[] = [{
      recurrence_pattern: "nth_weekday", month: 11, week_ordinal: "4th", day_of_week: "Thursday",
      is_working_day: false, name: "Thanksgiving",
    }];
    const results = resolveMonth(2026, 11, calendar, monFriPattern, [], rules);
    const thanksgiving = results.find((r) => r.date === "2026-11-26");
    expect(thanksgiving?.isWorkingDay).toBe(false);
    expect(thanksgiving?.label).toBe("Thanksgiving");
    // Every other Thursday in November should still resolve as working.
    const otherThursday = results.find((r) => r.date === "2026-11-05");
    expect(otherThursday?.isWorkingDay).toBe(true);
  });
});
