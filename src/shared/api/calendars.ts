import { apiRequest } from "./client";

export interface Calendar {
  calendar_id: string;
  project_id: string;
  name: string;
  type: "calendar_year" | "fiscal_year";
  start_date: string;
  end_date: string;
  cycle_anchor_date: string;
  work_pattern_cycle_days: number;
  created_at: string;
  updated_at: string;
}

export interface WorkPatternDayDTO {
  calendar_id: string;
  day_offset: number;
  is_working_day: boolean;
  hours: number;
  start_time: string | null;
  end_time: string | null;
}

// One shape covers both one-time and recurring rows — exception_type is
// what actually distinguishes them, matching exactly how the backend
// stores and returns them from a single calendar_exception table.
export interface CalendarExceptionDTO {
  exception_id: string;
  calendar_id: string;
  exception_type: "one_time" | "recurring";
  exception_date: string | null;
  is_working_day: boolean;
  name: string | null;
  obs_id: string | null;
  recurrence_pattern: "fixed_date" | "nth_weekday" | null;
  month: number | null;
  day: number | null;
  week_ordinal: "1st" | "2nd" | "3rd" | "4th" | "5th" | "last" | null;
  day_of_week: string | null;
}

export function listCalendars(projectId: string): Promise<Calendar[]> {
  return apiRequest<Calendar[]>("/calendars", { query: { projectId } });
}

export function getCalendar(calendarId: string): Promise<Calendar> {
  return apiRequest<Calendar>(`/calendars/${calendarId}`);
}

export function getWorkPattern(calendarId: string): Promise<WorkPatternDayDTO[]> {
  return apiRequest<WorkPatternDayDTO[]>(`/calendars/${calendarId}/work-pattern`);
}

export function listExceptions(calendarId: string): Promise<CalendarExceptionDTO[]> {
  return apiRequest<CalendarExceptionDTO[]>(`/calendars/${calendarId}/exceptions`);
}
