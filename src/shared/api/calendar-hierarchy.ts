import { apiRequest } from "./client";

// Epic 9.4 — which calendar actually applies at each level.
//
// The distinction this module exists to make visible: a calendar *belonging to*
// a project (calendar.project_id, which is what the Calendar screen lists) is
// not the same thing as the calendar *assigned to* that project
// (project.calendar_id, which is what the scheduling engine reads). A project
// can own several calendars and have none assigned — which is exactly the
// state every project created through this application has been in, because
// nothing ever set the assignment.

export interface ProjectCalendarAssignment {
  projectId: string;
  calendarId: string | null;
}

export function getProjectCalendar(projectId: string): Promise<ProjectCalendarAssignment> {
  return apiRequest<ProjectCalendarAssignment>(`/calendar-hierarchy/projects/${projectId}/calendar`);
}

export function setProjectCalendar(projectId: string, calendarId: string | null): Promise<unknown> {
  return apiRequest(`/calendar-hierarchy/projects/${projectId}/calendar`, {
    method: "PUT",
    body: { calendarId },
  });
}

export interface EnterpriseDefaultCalendar {
  calendarId: string | null;
}

// The platform-wide fallback, sitting above Project — an addition beyond the
// original specification. Seeded as null, so it is null until somebody sets it.
export function getEnterpriseDefaultCalendar(): Promise<EnterpriseDefaultCalendar> {
  return apiRequest<EnterpriseDefaultCalendar>("/calendar-hierarchy/enterprise-default");
}

export function setEnterpriseDefaultCalendar(calendarId: string | null): Promise<unknown> {
  return apiRequest("/calendar-hierarchy/enterprise-default", { method: "PUT", body: { calendarId } });
}
