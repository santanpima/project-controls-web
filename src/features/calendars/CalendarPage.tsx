import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as calendarsApi from "@shared/api/calendars";
import { resolveMonth, ResolvedDay, OneTimeException, RecurringRule } from "./day-resolution";

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function CalendarPage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const today = new Date();
  const [year, setYear] = useState(today.getUTCFullYear());
  const [month, setMonth] = useState(today.getUTCMonth() + 1); // 1-12

  const calendarsQuery = useQuery({
    queryKey: ["calendars", projectId],
    queryFn: () => calendarsApi.listCalendars(projectId as string),
    enabled: !!projectId,
  });

  // This screen deliberately doesn't offer a calendar picker yet — no UI
  // for choosing between multiple calendars on a project exists at this
  // point, only the backend support for having more than one. The first
  // calendar returned is shown; a real picker is future work once a
  // project genuinely has more than one calendar to choose between.
  const calendar = calendarsQuery.data?.[0];

  const patternQuery = useQuery({
    queryKey: ["work-pattern", calendar?.calendar_id],
    queryFn: () => calendarsApi.getWorkPattern(calendar!.calendar_id),
    enabled: !!calendar,
  });

  const exceptionsQuery = useQuery({
    queryKey: ["exceptions", calendar?.calendar_id],
    queryFn: () => calendarsApi.listExceptions(calendar!.calendar_id),
    enabled: !!calendar,
  });

  function goToPreviousMonth() {
    if (month === 1) { setMonth(12); setYear((y) => y - 1); } else { setMonth((m) => m - 1); }
  }
  function goToNextMonth() {
    if (month === 12) { setMonth(1); setYear((y) => y + 1); } else { setMonth((m) => m + 1); }
  }
  function goToToday() {
    setYear(today.getUTCFullYear());
    setMonth(today.getUTCMonth() + 1);
  }

  if (calendarsQuery.isLoading) {
    return <div className="text-sm text-neutral-500">Loading calendar...</div>;
  }
  if (calendarsQuery.isError) {
    return (
      <div className="rounded border border-status-error/30 bg-status-error/5 p-4 text-sm text-status-error">
        Couldn&apos;t load calendars for this project. {(calendarsQuery.error as Error)?.message}
      </div>
    );
  }
  if (!calendar) {
    return (
      <div className="rounded border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
        No calendar exists for this project yet.
      </div>
    );
  }
  if (patternQuery.isLoading || exceptionsQuery.isLoading) {
    return <div className="text-sm text-neutral-500">Loading calendar details...</div>;
  }

  const oneTimeExceptions: OneTimeException[] = (exceptionsQuery.data ?? [])
    .filter((e) => e.exception_type === "one_time" && e.exception_date)
    .map((e) => ({ exception_date: e.exception_date as string, is_working_day: e.is_working_day, name: e.name }));

  const recurringRules: RecurringRule[] = (exceptionsQuery.data ?? [])
    .filter((e) => e.exception_type === "recurring" && e.recurrence_pattern)
    .map((e) => ({
      recurrence_pattern: e.recurrence_pattern as "fixed_date" | "nth_weekday",
      month: e.month as number,
      day: e.day ?? undefined,
      week_ordinal: e.week_ordinal ?? undefined,
      day_of_week: e.day_of_week ?? undefined,
      is_working_day: e.is_working_day,
      name: e.name,
    }));

  const days: ResolvedDay[] = resolveMonth(year, month, calendar, patternQuery.data ?? [], oneTimeExceptions, recurringRules);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=Sun .. 6=Sat
  const leadingBlanks = Array.from({ length: firstWeekday });

  return (
    <div className="rounded bg-white shadow-elevation-1">
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200">
        <h1 className="text-lg font-semibold text-neutral-800">{calendar.name}</h1>
        <div className="flex items-center gap-2">
          <button onClick={goToPreviousMonth} className="p-1.5 rounded hover:bg-neutral-100" aria-label="Previous month">
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-medium w-36 text-center">
            {MONTH_NAMES[month - 1]} {year}
          </span>
          <button onClick={goToNextMonth} className="p-1.5 rounded hover:bg-neutral-100" aria-label="Next month">
            <ChevronRight size={18} />
          </button>
          <button onClick={goToToday} className="ml-2 px-2 py-1 text-xs rounded border border-neutral-300 hover:bg-neutral-50">
            Today
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-neutral-200">
        {DAY_HEADERS.map((d) => (
          <div key={d} className="px-2 py-2 text-xs font-medium text-neutral-500 text-center">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {leadingBlanks.map((_, i) => (
          <div key={`blank-${i}`} className="min-h-20 border-b border-r border-neutral-100 bg-neutral-50/50" />
        ))}
        {days.map((day) => {
          // Three visual states per 9.1.2.2.1: working (default), non-working
          // per pattern (muted), holiday/exception (a distinct highlight —
          // deliberately not status-warning/error, since a holiday isn't an
          // operational problem those tokens represent; brand-accent's own
          // tint is used instead, since no dedicated "holiday" token exists
          // in the design system).
          const isHoliday = day.source === "exception";
          const cellClass = isHoliday
            ? "bg-brand-accent/10 border-brand-accent/20"
            : day.isWorkingDay
              ? "bg-white border-neutral-100"
              : "bg-neutral-100 border-neutral-100";
          const dayNumber = Number(day.date.slice(8, 10));
          return (
            <div key={day.date} className={"min-h-20 border-b border-r p-1.5 " + cellClass} title={day.label ?? undefined}>
              <div className={"text-sm " + (isHoliday ? "font-semibold text-brand-accent" : "text-neutral-700")}>
                {dayNumber}
              </div>
              {day.label && <div className="mt-1 text-xs text-brand-accent truncate">{day.label}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
