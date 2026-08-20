// Pure logic for the schedule screen — no React, no API client, no DOM.
//
// Everything here is either a presentation decision the specification is
// explicit about (which fields are computed and therefore read-only) or a
// piece of arithmetic worth testing directly (hours to working days, float
// interpretation, dependency indexing).

export interface TaskLike {
  task_id: string;
  parent_task_id: string | null;
  name: string;
  duration_hours: string | number;
  total_float: string | null;
  is_critical: boolean;
  early_start: string | null;
  early_finish: string | null;
  percent_complete: string | null;
}

export interface DependencyLike {
  dependency_id: number;
  predecessor_task_id: string;
  successor_task_id: string;
  dependency_type: string;
  lag_hours: string | number;
}

// The pg driver returns numeric columns as strings so large values can't lose
// precision in transit. Every read of one has to go through this rather than
// trusting arithmetic on a string — `"8" * 2` happens to work in JavaScript,
// which is exactly what makes the bug it eventually causes hard to find.
export function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Duration and float are stored in working hours, because that is what the
// calendar-aware engine actually walks. People think in days, so both are
// shown in days against the standard 8-hour working day, with hours kept for
// anything that isn't a whole number of them.
export const HOURS_PER_WORKING_DAY = 8;

export function formatWorkingDuration(hours: string | number | null | undefined): string {
  const value = toNumber(hours);
  if (value === null) return "—";
  if (value === 0) return "0";
  const days = value / HOURS_PER_WORKING_DAY;
  if (Number.isInteger(days)) return `${days}d`;
  // Half a day reads better than "4h" for a duration; anything odder is left
  // in hours rather than rounded into a lie.
  if (Math.abs(days * 2 - Math.round(days * 2)) < 1e-9) return `${days}d`;
  return `${value}h`;
}

export type FloatStanding = "critical" | "negative" | "slack" | "unknown";

// What a float figure actually means, kept in one place so the table, any
// badge and any future Gantt all agree.
//
// Negative float is deliberately its own category rather than a kind of
// critical: zero float means "on the critical path, no room to slip", while
// negative float means the schedule as constrained is impossible — a hard
// date fighting the dependency logic. Both matter, and conflating them would
// hide the one that needs a decision.
export function floatStanding(task: Pick<TaskLike, "total_float" | "is_critical">): FloatStanding {
  const value = toNumber(task.total_float);
  if (value === null) return task.is_critical ? "critical" : "unknown";
  if (value < 0) return "negative";
  if (value === 0) return "critical";
  return "slack";
}

// Has CPM ever been run for this set of tasks? A task with no early_start has
// never been calculated, which is a different statement from "this task has
// no slack" and should never be displayed as though it were a result.
export function hasCpmResults(tasks: TaskLike[]): boolean {
  return tasks.some((t) => t.early_start !== null);
}

// Generic over the caller's own dependency type so indexing a list of fully
// typed dependencies hands back fully typed ones — widening them to the
// structural minimum here would force every caller to narrow them again.
export interface DependencyIndex<T extends DependencyLike = DependencyLike> {
  predecessorsOf: Map<string, T[]>;
  successorsOf: Map<string, T[]>;
}

// One pass over the dependency list, so a screen showing predecessors and
// successors per task doesn't filter the whole list once per row.
export function indexDependencies<T extends DependencyLike>(dependencies: T[]): DependencyIndex<T> {
  const predecessorsOf = new Map<string, T[]>();
  const successorsOf = new Map<string, T[]>();
  for (const dependency of dependencies) {
    const preds = predecessorsOf.get(dependency.successor_task_id);
    if (preds) preds.push(dependency);
    else predecessorsOf.set(dependency.successor_task_id, [dependency]);

    const succs = successorsOf.get(dependency.predecessor_task_id);
    if (succs) succs.push(dependency);
    else successorsOf.set(dependency.predecessor_task_id, [dependency]);
  }
  return { predecessorsOf, successorsOf };
}

// Which tasks may legally be a predecessor of the given one. The backend's own
// graph traversal is the real check — it refuses a dependency that would close
// a loop, across the whole network rather than one parent chain — but a task
// should never be offered itself, a task it already depends on, or anything
// that already depends on it, since all three are certain rejections.
export function validPredecessorOptions<T extends TaskLike>(
  tasks: T[],
  taskId: string,
  dependencies: DependencyLike[]
): T[] {
  const index = indexDependencies(dependencies);

  // Everything downstream of this task: adding any of them as a predecessor
  // would close a cycle.
  const downstream = new Set<string>();
  const queue = [taskId];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    for (const dependency of index.successorsOf.get(next) ?? []) {
      if (downstream.has(dependency.successor_task_id)) continue;
      downstream.add(dependency.successor_task_id);
      queue.push(dependency.successor_task_id);
    }
  }

  const alreadyPredecessor = new Set(
    (index.predecessorsOf.get(taskId) ?? []).map((d) => d.predecessor_task_id)
  );

  return tasks.filter(
    (t) => t.task_id !== taskId && !downstream.has(t.task_id) && !alreadyPredecessor.has(t.task_id)
  );
}

// Percent complete is nullable — never reported is not the same as zero, and
// showing "0%" for a task nobody has assessed would be inventing a status.
export function formatPercentComplete(value: string | null): string {
  const number = toNumber(value);
  return number === null ? "—" : `${number}%`;
}

export function formatDate(value: string | null): string {
  return value ? value.slice(0, 10) : "—";
}
