import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GanttChartSquare, Plus, Play, Pencil, Trash2, Link2, Info, AlertTriangle, X,
} from "lucide-react";
import { useAuth } from "@shared/auth/AuthContext";
import { readOnlyReason } from "@shared/auth/permissions";
import { Modal } from "@shared/components/Modal";
import { Tabs } from "@shared/components/Tabs";
import * as schedulingApi from "@shared/api/scheduling";
import * as wbsApi from "@shared/api/wbs";
import * as projectsApi from "@shared/api/projects";
import * as calendarHierarchyApi from "@shared/api/calendar-hierarchy";
import type { ScheduleTask } from "@shared/api/scheduling";
import {
  formatWorkingDuration, formatPercentComplete, formatDate, floatStanding, hasCpmResults, toNumber,
} from "./schedule-logic";
import { GanttChart, GanttLegend } from "./GanttChart";
import type { ZoomLevel } from "./gantt-scale";
import { TaskFormModal } from "./TaskFormModal";
import { TaskDependenciesPanel } from "./TaskDependenciesPanel";

// Theme 12's first screen. The engine behind it — forward pass, backward pass,
// total and free float, calendar-aware date math — has been built, tested and
// deployed for several phases with no way to see any of it. This is the screen
// that makes it visible.
//
// The Gantt itself (5.2.1.1.1) is deliberately a separate phase: a timeline is
// worth nothing until tasks and dependencies exist to draw, and those are what
// this screen creates.

type Notice = { kind: "info" | "warning" | "error"; text: string } | null;

const FLOAT_STYLES: Record<string, string> = {
  critical: "bg-status-error/10 text-status-error",
  negative: "bg-status-error/20 text-status-error font-semibold",
  slack: "bg-status-success/10 text-status-success",
  unknown: "bg-neutral-100 text-neutral-500",
};

export function SchedulePage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const { user, can } = useAuth();
  const canCreate = can("scheduling", "create");
  const canUpdate = can("scheduling", "update");
  const canDelete = can("scheduling", "delete");
  const readOnly = !canCreate && !canUpdate && !canDelete;

  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<{ task: ScheduleTask | null } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ScheduleTask | null>(null);
  const [view, setView] = useState("table");
  const [zoom, setZoom] = useState<ZoomLevel>("week");
  // Read once per render of this component rather than inside the chart, so
  // the chart itself stays a pure function of its props — the same reason its
  // geometry module takes no clock.
  const today = new Date().toISOString().slice(0, 10);

  const tasksQuery = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => schedulingApi.listTasks(projectId as string),
    enabled: !!projectId,
  });
  const dependenciesQuery = useQuery({
    queryKey: ["dependencies", projectId],
    queryFn: () => schedulingApi.listDependencies(projectId as string),
    enabled: !!projectId,
  });
  const wbsQuery = useQuery({
    queryKey: ["wbs", projectId],
    queryFn: () => wbsApi.listWbsElements(projectId as string),
    enabled: !!projectId,
  });
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => projectsApi.getProject(projectId as string),
    enabled: !!projectId,
  });
  // The engine needs a calendar to count working days against. A project can
  // own calendars without having one assigned — and every project created
  // through this application starts that way — so this is checked up front
  // rather than discovered as a failed calculation.
  const assignedCalendarQuery = useQuery({
    queryKey: ["project-calendar", projectId],
    queryFn: () => calendarHierarchyApi.getProjectCalendar(projectId as string),
    enabled: !!projectId,
  });
  const enterpriseCalendarQuery = useQuery({
    queryKey: ["enterprise-calendar"],
    queryFn: calendarHierarchyApi.getEnterpriseDefaultCalendar,
  });

  const tasks = useMemo<ScheduleTask[]>(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const dependencies = useMemo(() => dependenciesQuery.data ?? [], [dependenciesQuery.data]);
  const wbsElements = useMemo(() => wbsQuery.data ?? [], [wbsQuery.data]);
  const selected = tasks.find((t) => t.task_id === selectedId) ?? null;

  const wbsCodeOf = (wbsId: string) => wbsElements.find((w) => w.wbs_id === wbsId)?.code ?? "";
  const projectStartDate = projectQuery.data?.start_date ?? null;
  const calculated = hasCpmResults(tasks);
  // Resolved exactly the way the backend resolves it: the project's own
  // assignment, else the enterprise default. (A task may override with its
  // own calendar, which is why this is "can the project schedule at all".)
  const calendarsResolved = !assignedCalendarQuery.isLoading && !enterpriseCalendarQuery.isLoading;
  const hasCalendar =
    !!assignedCalendarQuery.data?.calendarId || !!enterpriseCalendarQuery.data?.calendarId;
  const canCalculate = !!projectStartDate && (hasCalendar || !calendarsResolved);

  function invalidateSchedule() {
    queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
    queryClient.invalidateQueries({ queryKey: ["dependencies", projectId] });
  }

  function reportError(error: unknown) {
    setNotice({
      kind: "error",
      text: error instanceof Error ? error.message : "Something went wrong with that request.",
    });
  }

  const createMutation = useMutation({
    mutationFn: (input: Omit<schedulingApi.CreateTaskInput, "projectId">) =>
      schedulingApi.createTask({ ...input, projectId: projectId as string }),
    onSuccess: () => {
      setEditing(null);
      setNotice({ kind: "info", text: "Task created." });
      invalidateSchedule();
    },
    onError: reportError,
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { taskId: string; fields: schedulingApi.TaskEditableFields }) =>
      schedulingApi.updateTask(vars.taskId, vars.fields),
    onSuccess: () => {
      setEditing(null);
      // Changing a duration or a constraint re-runs CPM server-side, so every
      // task's dates may have moved, not just this one's.
      setNotice({ kind: "info", text: "Task saved." });
      invalidateSchedule();
    },
    onError: reportError,
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => schedulingApi.deleteTask(taskId),
    onSuccess: (_result, taskId) => {
      setPendingDelete(null);
      if (selectedId === taskId) setSelectedId(null);
      setNotice({ kind: "info", text: "Task deleted." });
      invalidateSchedule();
    },
    onError: (error) => {
      setPendingDelete(null);
      reportError(error);
    },
  });

  const dependencyMutation = useMutation({
    mutationFn: (input: Parameters<typeof schedulingApi.createDependency>[0]) =>
      schedulingApi.createDependency(input),
    onSuccess: () => {
      setNotice({ kind: "info", text: "Dependency added — the schedule has been recalculated." });
      invalidateSchedule();
    },
    onError: reportError,
  });

  const removeDependencyMutation = useMutation({
    mutationFn: (dependencyId: number) => schedulingApi.deleteDependency(dependencyId),
    onSuccess: () => {
      setNotice({ kind: "info", text: "Dependency removed — the schedule has been recalculated." });
      invalidateSchedule();
    },
    onError: reportError,
  });

  const cpmMutation = useMutation({
    mutationFn: () => schedulingApi.runCpm(projectId as string, projectStartDate as string),
    onSuccess: (result) => {
      const negative = result.negativeFloatTasks ?? [];
      setNotice(
        negative.length > 0
          ? {
              kind: "warning",
              text:
                `Schedule calculated for ${result.taskCount} task${result.taskCount === 1 ? "" : "s"}` +
                (result.projectEndDate ? `, finishing ${formatDate(result.projectEndDate)}` : "") +
                `. ${negative.length} task${negative.length === 1 ? " has" : "s have"} negative float — a hard ` +
                `constraint is fighting the dependency logic, so the schedule as constrained isn't achievable.`,
            }
          : {
              kind: "info",
              text:
                `Schedule calculated for ${result.taskCount} task${result.taskCount === 1 ? "" : "s"}` +
                (result.projectEndDate ? `, finishing ${formatDate(result.projectEndDate)}.` : "."),
            }
      );
      invalidateSchedule();
    },
    onError: reportError,
  });

  const isSaving =
    createMutation.isPending || updateMutation.isPending || deleteMutation.isPending ||
    dependencyMutation.isPending || removeDependencyMutation.isPending || cpmMutation.isPending;

  if (tasksQuery.isLoading || wbsQuery.isLoading) {
    return <div className="text-sm text-neutral-500">Loading schedule...</div>;
  }
  if (tasksQuery.isError) {
    return (
      <div className="rounded border border-status-error/30 bg-status-error/5 p-4 text-sm text-status-error">
        Couldn&apos;t load the schedule for this project. {(tasksQuery.error as Error)?.message}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <div
          className={
            "flex items-start gap-2 rounded border p-3 text-sm " +
            (notice.kind === "error"
              ? "border-status-error/30 bg-status-error/5 text-status-error"
              : notice.kind === "warning"
                ? "border-status-warning/30 bg-status-warning/5 text-status-warning"
                : "border-status-info/30 bg-status-info/5 text-status-info")
          }
        >
          {notice.kind === "warning" ? (
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          ) : (
            <Info size={16} className="mt-0.5 shrink-0" />
          )}
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss message">
            <X size={16} />
          </button>
        </div>
      )}

      {/* The engine silently declines to calculate a project with no start
          date — there is nothing to count forward from. That would otherwise
          look like a broken button, so it's said plainly instead. */}
      {!projectStartDate && (
        <div className="rounded border border-status-warning/30 bg-status-warning/5 p-3 text-sm text-status-warning">
          This project has no start date, so the schedule can&apos;t be calculated — the forward pass has
          nothing to count from. Set one in{" "}
          <Link to={`/projects/${projectId}/settings`} className="underline">
            project settings
          </Link>
          , then run the calculation.
        </div>
      )}

      {calendarsResolved && !hasCalendar && (
        <div className="rounded border border-status-warning/30 bg-status-warning/5 p-3 text-sm text-status-warning">
          This project has no scheduling calendar assigned, so the critical path can&apos;t be calculated —
          the engine counts working days, and without a calendar it has no way to know which days those are.
          Assign one in{" "}
          <Link to={`/projects/${projectId}/settings`} className="underline">
            project settings
          </Link>
          . Note that a calendar <em>belonging to</em> this project isn&apos;t the same as one{" "}
          <em>assigned to</em> it — the assignment is what the engine reads.
        </div>
      )}

      {readOnly && (
        <div className="rounded border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
          {readOnlyReason(user?.role_name, "the schedule")} You can review tasks, dependencies and calculated
          dates; changing them needs a role with edit access.
        </div>
      )}

      <div className="flex flex-col gap-4 xl:flex-row">
        <section className="min-w-0 flex-1 rounded bg-white shadow-elevation-1">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <GanttChartSquare size={18} className="text-brand-primary" />
              <h1 className="text-lg font-semibold text-neutral-800">Schedule</h1>
              <span className="text-xs text-neutral-500">
                {tasks.length} task{tasks.length === 1 ? "" : "s"} · {dependencies.length} dependenc
                {dependencies.length === 1 ? "y" : "ies"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {view === "timeline" && (
                <div className="flex items-center gap-1 rounded border border-neutral-300 p-0.5">
                  {(["week", "month"] as ZoomLevel[]).map((level) => (
                    <button
                      key={level}
                      onClick={() => setZoom(level)}
                      className={
                        "rounded px-2 py-0.5 text-xs " +
                        (zoom === level ? "bg-brand-primary text-white" : "text-neutral-600 hover:bg-neutral-50")
                      }
                    >
                      {level === "week" ? "Weeks" : "Months"}
                    </button>
                  ))}
                </div>
              )}
              {canUpdate && (
                <button
                  onClick={() => cpmMutation.mutate()}
                  disabled={isSaving || !canCalculate || tasks.length === 0}
                  className="flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
                  title={
                    !projectStartDate
                      ? "Needs a project start date"
                      : !hasCalendar
                        ? "Needs a scheduling calendar assigned to the project"
                        : "Run the critical path calculation"
                  }
                >
                  <Play size={14} /> {cpmMutation.isPending ? "Calculating..." : "Calculate schedule"}
                </button>
              )}
              {canCreate && (
                <button
                  onClick={() => setEditing({ task: null })}
                  disabled={wbsElements.length === 0}
                  className="flex items-center gap-1 rounded bg-brand-primary px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                  title={wbsElements.length === 0 ? "Build a WBS first — every task belongs to a WBS element" : ""}
                >
                  <Plus size={14} /> New task
                </button>
              )}
            </div>
          </div>

          {tasks.length > 0 && (
            <div className="px-4 pt-2">
              <Tabs
                tabs={[
                  { key: "table", label: "Table" },
                  { key: "timeline", label: "Timeline" },
                ]}
                activeKey={view}
                onChange={setView}
              />
            </div>
          )}

          {wbsElements.length === 0 ? (
            <div className="p-8 text-center text-sm text-neutral-500">
              This project has no WBS elements yet, and every task belongs to one. Build the{" "}
              <Link to={`/projects/${projectId}/wbs`} className="text-brand-accent underline">
                work breakdown structure
              </Link>{" "}
              first.
            </div>
          ) : tasks.length === 0 ? (
            <div className="p-8 text-center text-sm text-neutral-500">
              No tasks yet. {canCreate ? "Create one to start building the schedule." : ""}
            </div>
          ) : view === "timeline" ? (
            <div>
              <GanttChart
                tasks={tasks}
                dependencies={dependencies}
                zoom={zoom}
                today={today}
                selectedTaskId={selectedId}
                onSelectTask={setSelectedId}
              />
              <GanttLegend />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs font-medium text-neutral-500">
                    <th className="px-3 py-2">Task</th>
                    <th className="px-3 py-2">WBS</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Duration</th>
                    <th className="px-3 py-2">Complete</th>
                    <th className="px-3 py-2">Early start</th>
                    <th className="px-3 py-2">Early finish</th>
                    <th className="px-3 py-2">Float</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {tasks.map((task) => {
                    const standing = floatStanding(task);
                    const isSelected = task.task_id === selectedId;
                    return (
                      <tr
                        key={task.task_id}
                        className={isSelected ? "bg-brand-accent/5" : "hover:bg-neutral-50"}
                      >
                        <td className="px-3 py-2">
                          <button
                            onClick={() => setSelectedId(task.task_id)}
                            className="text-left font-medium text-neutral-800 hover:text-brand-primary"
                          >
                            {task.name}
                          </button>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-neutral-500">
                          {wbsCodeOf(task.wbs_id)}
                        </td>
                        <td className="px-3 py-2 text-xs text-neutral-600">
                          {schedulingApi.ACTIVITY_TYPES.find((t) => t.value === task.activity_type)?.label}
                        </td>
                        <td className="px-3 py-2 text-neutral-700">
                          {formatWorkingDuration(task.duration_hours)}
                        </td>
                        <td className="px-3 py-2 text-neutral-700">
                          {formatPercentComplete(task.percent_complete)}
                        </td>
                        <td className="px-3 py-2 text-neutral-700">{formatDate(task.early_start)}</td>
                        <td className="px-3 py-2 text-neutral-700">{formatDate(task.early_finish)}</td>
                        <td className="px-3 py-2">
                          <span className={"rounded px-1.5 py-0.5 text-xs " + FLOAT_STYLES[standing]}>
                            {standing === "unknown"
                              ? "not calculated"
                              : standing === "critical"
                                ? "critical"
                                : formatWorkingDuration(toNumber(task.total_float) ?? 0)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setSelectedId(task.task_id)}
                              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                              aria-label={`Dependencies for ${task.name}`}
                              title="Dependencies"
                            >
                              <Link2 size={14} />
                            </button>
                            {canUpdate && (
                              <button
                                onClick={() => setEditing({ task })}
                                className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                                aria-label={`Edit ${task.name}`}
                                title="Edit task"
                              >
                                <Pencil size={14} />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                onClick={() => setPendingDelete(task)}
                                className="rounded p-1 text-neutral-400 hover:bg-status-error/10 hover:text-status-error"
                                aria-label={`Delete ${task.name}`}
                                title="Delete task"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {tasks.length > 0 && !calculated && (
            <div className="border-t border-neutral-100 px-4 py-3 text-xs text-neutral-500">
              These tasks haven&apos;t been through the schedule calculation yet, so their dates and float are
              blank rather than zero. {canUpdate ? "Calculate the schedule to fill them in." : ""}
            </div>
          )}
        </section>

        {selected && (
          <TaskDependenciesPanel
            key={selected.task_id}
            task={selected}
            tasks={tasks}
            dependencies={dependencies}
            isSaving={isSaving}
            canEdit={canUpdate}
            onClose={() => setSelectedId(null)}
            onAdd={(input) => dependencyMutation.mutate(input)}
            onRemove={(dependencyId) => removeDependencyMutation.mutate(dependencyId)}
          />
        )}
      </div>

      {editing && (
        <TaskFormModal
          key={editing.task?.task_id ?? "new"}
          task={editing.task}
          wbsElements={wbsElements}
          isSaving={isSaving}
          onClose={() => setEditing(null)}
          onCreate={(input) => createMutation.mutate(input)}
          onUpdate={(fields) =>
            editing.task && updateMutation.mutate({ taskId: editing.task.task_id, fields })
          }
        />
      )}

      <Modal open={pendingDelete !== null} onClose={() => setPendingDelete(null)} title="Delete this task?">
        <p className="text-sm text-neutral-700">
          {pendingDelete?.name} will be removed from the schedule, along with any dependencies attached to it.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete.task_id)}
            disabled={deleteMutation.isPending}
            className="rounded bg-status-error px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete task"}
          </button>
          <button
            onClick={() => setPendingDelete(null)}
            className="rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
          >
            Cancel
          </button>
        </div>
      </Modal>
    </div>
  );
}
