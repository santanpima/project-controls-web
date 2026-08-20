import { apiRequest } from "./client";

// Typed client for Theme 12 (Scheduling Engine) — the largest backend in this
// application and, until this screen, the most completely invisible one:
// critical path, total and free float, calendar-aware date math and baselines
// have all been computed and tested for several phases with nothing to show
// them.
//
// The one rule that shapes this whole module: a task's raw inputs (name,
// duration, constraints) are editable, and its CPM outputs (early/late dates,
// float, criticality) are not. The backend enforces that by simply not listing
// the computed columns as updatable, so an attempt to set one is ignored
// rather than rejected — modeled here as two separate types so a screen can't
// accidentally offer one for editing.

export type ActivityType = "task" | "milestone" | "level_of_effort" | "summary";
export type ConstraintType = "ASAP" | "ALAP" | "SNET" | "FNET" | "MSO" | "MFO";
export type DependencyType = "FS" | "SS" | "FF" | "SF";

export const ACTIVITY_TYPES: { value: ActivityType; label: string; hint: string }[] = [
  { value: "task", label: "Task", hint: "Ordinary work with a real duration." },
  { value: "milestone", label: "Milestone", hint: "A zero-duration marker — a date, not work." },
  { value: "level_of_effort", label: "Level of effort", hint: "Ongoing support work, not discretely measurable." },
  { value: "summary", label: "Summary", hint: "A rollup of the tasks beneath it." },
];

// 12.2.3.1.1's six standard constraint types, with what each one actually
// does — these abbreviations are industry-standard and completely opaque to
// anyone who hasn't used a scheduling tool before.
export const CONSTRAINT_TYPES: { value: ConstraintType; label: string }[] = [
  { value: "ASAP", label: "As soon as possible" },
  { value: "ALAP", label: "As late as possible" },
  { value: "SNET", label: "Start no earlier than" },
  { value: "FNET", label: "Finish no earlier than" },
  { value: "MSO", label: "Must start on" },
  { value: "MFO", label: "Must finish on" },
];

// Whether a constraint type needs an accompanying date — ASAP and ALAP are
// scheduling rules, the other four are anchored to a specific day.
export function constraintNeedsDate(type: ConstraintType): boolean {
  return type !== "ASAP" && type !== "ALAP";
}

export const DEPENDENCY_TYPES: { value: DependencyType; label: string; hint: string }[] = [
  { value: "FS", label: "Finish → Start", hint: "The successor starts after the predecessor finishes." },
  { value: "SS", label: "Start → Start", hint: "Both start together." },
  { value: "FF", label: "Finish → Finish", hint: "Both finish together." },
  { value: "SF", label: "Start → Finish", hint: "The successor finishes after the predecessor starts." },
];

export interface ScheduleTask {
  task_id: string;
  project_id: string;
  wbs_id: string;
  calendar_id: string | null;
  parent_task_id: string | null;
  resolved_planning_wbs_id: string | null;
  name: string;
  // numeric columns arrive as strings from the pg driver, deliberately, so
  // large values can't lose precision on the way through JSON.
  duration_hours: string;
  activity_type: ActivityType;
  percent_complete: string | null;
  start_date: string | null;
  finish_date: string | null;
  constraint_type: ConstraintType;
  constraint_date: string | null;
  // --- CPM outputs: computed, never directly editable -----------------------
  early_start: string | null;
  early_finish: string | null;
  late_start: string | null;
  late_finish: string | null;
  total_float: string | null;
  free_float: string | null;
  is_critical: boolean;
  created_at: string;
  updated_at: string;
}

export interface TaskDependency {
  dependency_id: number;
  predecessor_task_id: string;
  successor_task_id: string;
  dependency_type: DependencyType;
  lag_hours: string;
}

export interface CreateTaskInput {
  projectId: string;
  wbsId: string;
  name: string;
  parentTaskId?: string | null;
  durationHours?: number;
  activityType?: ActivityType;
  percentComplete?: number | null;
  constraintType?: ConstraintType;
  constraintDate?: string | null;
}

// snake_case, matching the update endpoint's own column allow-list — the same
// split between create and update this codebase uses everywhere else.
export interface TaskEditableFields {
  name?: string;
  duration_hours?: number;
  activity_type?: ActivityType;
  percent_complete?: number | null;
  constraint_type?: ConstraintType;
  constraint_date?: string | null;
  parent_task_id?: string | null;
}

export function listTasks(projectId: string): Promise<ScheduleTask[]> {
  return apiRequest<ScheduleTask[]>("/scheduling", { query: { projectId } });
}

export function createTask(input: CreateTaskInput): Promise<ScheduleTask> {
  return apiRequest<ScheduleTask>("/scheduling", { method: "POST", body: input });
}

// Changing duration, a constraint type or a constraint date re-runs CPM for
// the whole project server-side; changing a name or percent complete doesn't.
// Either way the client refetches, so it doesn't need to predict which.
export function updateTask(taskId: string, fields: TaskEditableFields): Promise<ScheduleTask> {
  return apiRequest<ScheduleTask>(`/scheduling/${taskId}`, { method: "PUT", body: fields });
}

export function deleteTask(taskId: string): Promise<void> {
  return apiRequest<void>(`/scheduling/${taskId}`, { method: "DELETE" });
}

export function listDependencies(projectId: string): Promise<TaskDependency[]> {
  return apiRequest<TaskDependency[]>("/scheduling/dependencies", { query: { projectId } });
}

// A dependency that would close a loop is refused by the backend's own graph
// traversal with a 400 — genuinely a cycle check across a network, not the
// simple parent walk a tree needs.
export function createDependency(input: {
  predecessorTaskId: string;
  successorTaskId: string;
  dependencyType: DependencyType;
  lagHours: number;
}): Promise<TaskDependency> {
  return apiRequest<TaskDependency>("/scheduling/dependencies", { method: "POST", body: input });
}

export function deleteDependency(dependencyId: number): Promise<void> {
  return apiRequest<void>(`/scheduling/dependencies/${dependencyId}`, { method: "DELETE" });
}

// 12.3.1.1.1–3 — the full forward pass, backward pass and float calculation.
// negativeFloatTasks is a soft warning, never a refusal: negative float means
// a hard constraint and the dependency logic disagree, which is real
// information rather than an error.
export interface CpmResult {
  taskCount: number;
  projectEndDate?: string;
  negativeFloatTasks?: { taskId: string; totalFloat: number }[];
}

export function runCpm(projectId: string, projectStartDate: string): Promise<CpmResult> {
  return apiRequest<CpmResult>("/scheduling/run-cpm", {
    method: "POST",
    body: { projectId, projectStartDate },
  });
}
