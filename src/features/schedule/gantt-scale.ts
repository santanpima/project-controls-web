// The maths behind the Gantt: turning dates into pixels, and pixels into a
// readable time axis. Pure — no React, no DOM, no clock — so every edge case
// here is testable directly, which is the whole reason this timeline is
// hand-built rather than delegated to a library.
//
// One deliberate omission worth naming: nothing here shades weekends. It would
// be easy to grey out Saturdays and Sundays, and it would be a lie — this
// application's non-working days come from each project's own calendar, which
// can be a 9/80 cycle, a four-day week, or carry holidays this module knows
// nothing about. Drawing a conventional weekend would assert calendar
// knowledge the chart doesn't have. The bars themselves are already
// calendar-correct, because the engine computed them that way.

export type ZoomLevel = "week" | "month";

// Pixels per day at each zoom. A week view gives a legible ~200px week; a
// month view fits roughly a year and a half on a wide screen.
export const PIXELS_PER_DAY: Record<ZoomLevel, number> = { week: 28, month: 6 };

export const ROW_HEIGHT = 32;
export const BAR_HEIGHT = 14;

// --- date helpers -----------------------------------------------------------
// Everything is UTC and date-only. Local-time parsing is what makes a bar jump
// a day for anyone east or west of the server, so a plain "YYYY-MM-DD" is
// always read as UTC midnight here.

export function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
  const date = parseDate(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIso(date);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Whole days from one date to another; negative if `date` is earlier.
export function daysBetween(fromDateStr: string, toDateStr: string): number {
  return Math.round((parseDate(toDateStr).getTime() - parseDate(fromDateStr).getTime()) / MS_PER_DAY);
}

// --- timeline bounds --------------------------------------------------------

export interface BarSource {
  early_start: string | null;
  early_finish: string | null;
}

export interface TimelineBounds {
  start: string;
  end: string;
  days: number;
}

// The span the chart has to cover, with a few days of padding so bars don't
// begin flush against the axis. Returns null when nothing has been calculated
// yet — the caller shows an explanation rather than an empty grid pretending
// to be a timeline.
export function computeBounds(tasks: BarSource[], paddingDays = 2): TimelineBounds | null {
  const starts = tasks.map((t) => t.early_start).filter((d): d is string => !!d);
  const finishes = tasks.map((t) => t.early_finish).filter((d): d is string => !!d);
  if (starts.length === 0) return null;

  const earliest = starts.reduce((min, d) => (d < min ? d : min));
  // A task can have a start with no finish (a milestone the engine resolved to
  // a single day), so the finish list may be shorter — fall back to the starts.
  const latest = [...finishes, ...starts].reduce((max, d) => (d > max ? d : max));

  const start = addDays(earliest, -paddingDays);
  const end = addDays(latest, paddingDays);
  return { start, end, days: daysBetween(start, end) + 1 };
}

export function xForDate(dateStr: string, bounds: TimelineBounds, zoom: ZoomLevel): number {
  return daysBetween(bounds.start, dateStr) * PIXELS_PER_DAY[zoom];
}

export function timelineWidth(bounds: TimelineBounds, zoom: ZoomLevel): number {
  return bounds.days * PIXELS_PER_DAY[zoom];
}

// --- bars -------------------------------------------------------------------

export interface BarGeometry {
  x: number;
  width: number;
  isPoint: boolean; // a milestone, or any task resolved to a single day
}

// A bar spans start..finish inclusive, so a one-day task is one day wide, not
// zero. A task the engine hasn't calculated yet has no bar at all — returning
// null rather than a zero-width rectangle keeps "not calculated" visually
// distinct from "instantaneous", which is exactly the distinction the table
// column makes too.
export function barGeometry(task: BarSource, bounds: TimelineBounds, zoom: ZoomLevel): BarGeometry | null {
  if (!task.early_start) return null;
  const finish = task.early_finish ?? task.early_start;
  const pxPerDay = PIXELS_PER_DAY[zoom];
  const x = xForDate(task.early_start, bounds, zoom);
  const spanDays = Math.max(0, daysBetween(task.early_start, finish)) + 1;
  const width = spanDays * pxPerDay;
  return { x, width, isPoint: spanDays <= 1 };
}

// The filled portion of a bar. Percent complete is nullable, and unreported is
// not zero — an unassessed task gets no progress fill rather than an empty one
// implying somebody looked and found nothing done.
export function progressWidth(percentComplete: string | number | null, barWidth: number): number | null {
  if (percentComplete === null || percentComplete === undefined || percentComplete === "") return null;
  const pct = Number(percentComplete);
  if (!Number.isFinite(pct)) return null;
  return (Math.max(0, Math.min(100, pct)) / 100) * barWidth;
}

// --- axis ticks -------------------------------------------------------------

export interface Tick {
  date: string;
  x: number;
  label: string;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Week zoom ticks on Mondays; month zoom ticks on the first of each month.
// Both start from the first such day at or after the timeline's own start, so
// a tick never sits off the left edge of the chart.
export function generateTicks(bounds: TimelineBounds, zoom: ZoomLevel): Tick[] {
  const ticks: Tick[] = [];
  const last = bounds.end;

  if (zoom === "week") {
    let cursor = bounds.start;
    // 1 = Monday in getUTCDay's 0=Sunday numbering.
    while (parseDate(cursor).getUTCDay() !== 1) cursor = addDays(cursor, 1);
    while (cursor <= last) {
      const date = parseDate(cursor);
      ticks.push({
        date: cursor,
        x: xForDate(cursor, bounds, zoom),
        label: `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}`,
      });
      cursor = addDays(cursor, 7);
    }
    return ticks;
  }

  let cursor = bounds.start;
  if (parseDate(cursor).getUTCDate() !== 1) {
    const d = parseDate(cursor);
    cursor = formatIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
  }
  while (cursor <= last) {
    const date = parseDate(cursor);
    ticks.push({
      date: cursor,
      x: xForDate(cursor, bounds, zoom),
      label: `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
    });
    cursor = formatIso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)));
  }
  return ticks;
}

// --- dependency lines -------------------------------------------------------

export type DependencyKind = "FS" | "SS" | "FF" | "SF";

export interface Point {
  x: number;
  y: number;
}

// Which end of each bar a relationship actually connects. This is the part a
// Gantt gets visibly wrong if it treats every link as finish-to-start: an SS
// link drawn from the predecessor's right edge would show the opposite of what
// it means.
export function anchorPoints(
  kind: DependencyKind,
  from: BarGeometry,
  to: BarGeometry,
  fromRowIndex: number,
  toRowIndex: number,
  rowHeight = ROW_HEIGHT
): { start: Point; end: Point } {
  const centreY = (rowIndex: number) => rowIndex * rowHeight + rowHeight / 2;
  const fromX = kind === "SS" || kind === "SF" ? from.x : from.x + from.width;
  const toX = kind === "FF" || kind === "SF" ? to.x + to.width : to.x;
  return {
    start: { x: fromX, y: centreY(fromRowIndex) },
    end: { x: toX, y: centreY(toRowIndex) },
  };
}

// An orthogonal (right-angled) route between two anchors, the convention every
// scheduling tool uses. When the successor starts left of where the line
// leaves the predecessor — normal for SS links and for any dependency with
// negative lag — the route steps out, back, and in again rather than drawing a
// diagonal through unrelated rows.
export function dependencyPath(start: Point, end: Point, stub = 8): string {
  const points: Point[] = [start];
  if (end.x >= start.x + stub * 2) {
    const midX = end.x - stub;
    points.push({ x: midX, y: start.y }, { x: midX, y: end.y });
  } else {
    const outX = start.x + stub;
    const backX = end.x - stub;
    const midY = (start.y + end.y) / 2;
    points.push(
      { x: outX, y: start.y },
      { x: outX, y: midY },
      { x: backX, y: midY },
      { x: backX, y: end.y }
    );
  }
  points.push(end);
  return points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ");
}
