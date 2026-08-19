// A faithful port of the backend's own resolution logic
// (holiday-math.js + service.js's resolveDay), not a reimplementation from
// scratch — validated against known real-world dates (Thanksgiving,
// Memorial Day, Labor Day) before being written here. This exists because
// the backend's GET /:id/resolve endpoint resolves one date at a time; a
// month view needs ~30 days resolved, and 30 individual API calls per
// month is real, avoidable waste when the same result can be computed
// locally from two API calls (work pattern + exceptions) made once.

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface RecurringRule {
  recurrence_pattern: "fixed_date" | "nth_weekday";
  month: number;
  day?: number;
  week_ordinal?: "1st" | "2nd" | "3rd" | "4th" | "5th" | "last";
  day_of_week?: string;
  is_working_day: boolean;
  name: string | null;
}

export interface OneTimeException {
  exception_date: string;
  is_working_day: boolean;
  name: string | null;
}

export interface WorkPatternDay {
  day_offset: number;
  is_working_day: boolean;
  hours: number;
  start_time: string | null;
  end_time: string | null;
}

export interface CalendarCore {
  cycle_anchor_date: string;
  work_pattern_cycle_days: number;
}

export interface ResolvedDay {
  date: string;
  isWorkingDay: boolean;
  source: "exception" | "pattern" | "pattern-undefined";
  label: string | null;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function resolveFixedDate(month: number, day: number, year: number): string {
  return toISODate(new Date(Date.UTC(year, month - 1, day)));
}

function resolveNthWeekday(
  month: number,
  weekOrdinal: string,
  dayOfWeek: string,
  year: number
): string | null {
  const targetDow = DAY_NAMES.indexOf(dayOfWeek);
  if (targetDow === -1) throw new Error(`invalid day_of_week: ${dayOfWeek}`);

  const occurrences: Date[] = [];
  const cursor = new Date(Date.UTC(year, month - 1, 1));
  while (cursor.getUTCMonth() === month - 1) {
    if (cursor.getUTCDay() === targetDow) occurrences.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  if (weekOrdinal === "last") return toISODate(occurrences[occurrences.length - 1]);
  const ordinalIndex = { "1st": 0, "2nd": 1, "3rd": 2, "4th": 3, "5th": 4 }[weekOrdinal];
  if (ordinalIndex === undefined) throw new Error(`invalid week_ordinal: ${weekOrdinal}`);
  if (!occurrences[ordinalIndex]) return null; // e.g. a "5th Friday" that doesn't exist that month/year
  return toISODate(occurrences[ordinalIndex]);
}

export function resolveRecurrence(rule: RecurringRule, year: number): string | null {
  if (rule.recurrence_pattern === "fixed_date") return resolveFixedDate(rule.month, rule.day as number, year);
  if (rule.recurrence_pattern === "nth_weekday") {
    return resolveNthWeekday(rule.month, rule.week_ordinal as string, rule.day_of_week as string, year);
  }
  throw new Error(`unknown recurrence_pattern: ${(rule as RecurringRule).recurrence_pattern}`);
}

// Mirrors resolveDay's exact precedence: a one-time exception wins over a
// recurring one, which wins over the base work pattern. Same order, same
// tie-breaking, as the backend — this has to agree with the server's own
// /resolve endpoint for any single date, not just look plausible.
export function resolveDay(
  dateStr: string,
  calendar: CalendarCore,
  pattern: WorkPatternDay[],
  oneTimeExceptions: OneTimeException[],
  recurringRules: RecurringRule[]
): ResolvedDay {
  const oneTime = oneTimeExceptions.find((e) => e.exception_date === dateStr);
  if (oneTime) {
    return { date: dateStr, isWorkingDay: oneTime.is_working_day, source: "exception", label: oneTime.name };
  }

  const year = new Date(dateStr).getUTCFullYear();
  for (const rule of recurringRules) {
    if (resolveRecurrence(rule, year) === dateStr) {
      return { date: dateStr, isWorkingDay: rule.is_working_day, source: "exception", label: rule.name };
    }
  }

  const date = new Date(dateStr);
  const anchor = new Date(calendar.cycle_anchor_date);
  const daysSinceAnchor = Math.floor((date.getTime() - anchor.getTime()) / 86400000);
  const cycleDays = calendar.work_pattern_cycle_days;
  const dayOffset = ((daysSinceAnchor % cycleDays) + cycleDays) % cycleDays;

  const patternDay = pattern.find((p) => p.day_offset === dayOffset);
  if (!patternDay) return { date: dateStr, isWorkingDay: false, source: "pattern-undefined", label: null };

  return { date: dateStr, isWorkingDay: patternDay.is_working_day, source: "pattern", label: null };
}

// Resolves every day in a given month in one pass — what the month grid
// view actually needs, built on top of the single-day resolver above.
export function resolveMonth(
  year: number,
  month: number, // 1-12
  calendar: CalendarCore,
  pattern: WorkPatternDay[],
  oneTimeExceptions: OneTimeException[],
  recurringRules: RecurringRule[]
): ResolvedDay[] {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const results: ResolvedDay[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = toISODate(new Date(Date.UTC(year, month - 1, day)));
    results.push(resolveDay(dateStr, calendar, pattern, oneTimeExceptions, recurringRules));
  }
  return results;
}
