import { useState } from "react";
import { X, Trash2, Link2, ArrowRight } from "lucide-react";
import { Select } from "@shared/components/Select";
import { TextInput } from "@shared/components/TextInput";
import * as schedulingApi from "@shared/api/scheduling";
import type { DependencyType, ScheduleTask, TaskDependency } from "@shared/api/scheduling";
import { indexDependencies, validPredecessorOptions, toNumber, HOURS_PER_WORKING_DAY } from "./schedule-logic";

// 12.2.2.1.1 — dependency editing for one selected task, in both directions.
//
// Showing successors as well as predecessors is deliberate: a dependency is
// one row in the database but two facts to a person planning work, and the
// task you're looking at is as often the predecessor as the successor.

interface TaskDependenciesPanelProps {
  task: ScheduleTask;
  tasks: ScheduleTask[];
  dependencies: TaskDependency[];
  isSaving: boolean;
  canEdit: boolean;
  onClose: () => void;
  onAdd: (input: { predecessorTaskId: string; successorTaskId: string; dependencyType: DependencyType; lagHours: number }) => void;
  onRemove: (dependencyId: number) => void;
}

export function TaskDependenciesPanel({
  task, tasks, dependencies, isSaving, canEdit, onClose, onAdd, onRemove,
}: TaskDependenciesPanelProps): JSX.Element {
  const [predecessorId, setPredecessorId] = useState("");
  const [dependencyType, setDependencyType] = useState<DependencyType>("FS");
  const [lagDays, setLagDays] = useState("0");

  const index = indexDependencies(dependencies);
  const predecessors = index.predecessorsOf.get(task.task_id) ?? [];
  const successors = index.successorsOf.get(task.task_id) ?? [];
  const nameOf = (taskId: string) => tasks.find((t) => t.task_id === taskId)?.name ?? "(deleted task)";

  // Never offer a link the backend's cycle check would certainly refuse — the
  // task itself, anything already downstream of it, or an existing predecessor.
  const options = validPredecessorOptions(tasks, task.task_id, dependencies);

  function formatLag(lagHours: string) {
    const hours = toNumber(lagHours) ?? 0;
    if (hours === 0) return "";
    const days = hours / HOURS_PER_WORKING_DAY;
    const sign = hours > 0 ? "+" : "";
    return ` ${sign}${Number.isInteger(days) ? days : hours / HOURS_PER_WORKING_DAY}d`;
  }

  function renderRow(dependency: TaskDependency, otherTaskId: string, direction: "from" | "to") {
    return (
      <li key={dependency.dependency_id} className="flex items-center gap-2 py-1.5 text-sm">
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-600">
          {dependency.dependency_type}
          {formatLag(dependency.lag_hours)}
        </span>
        {direction === "from" && <ArrowRight size={12} className="shrink-0 text-neutral-400" />}
        <span className="min-w-0 flex-1 truncate text-neutral-800">{nameOf(otherTaskId)}</span>
        {canEdit && (
          <button
            onClick={() => onRemove(dependency.dependency_id)}
            disabled={isSaving}
            className="rounded p-1 text-neutral-400 hover:bg-status-error/10 hover:text-status-error disabled:opacity-50"
            aria-label="Remove this dependency"
            title="Remove dependency"
          >
            <Trash2 size={13} />
          </button>
        )}
      </li>
    );
  }

  return (
    <aside className="rounded bg-white shadow-elevation-1 xl:w-[420px] xl:shrink-0">
      <div className="flex items-start justify-between gap-2 border-b border-neutral-200 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-neutral-500">
            <Link2 size={12} /> Dependencies
          </div>
          <h2 className="truncate text-lg font-semibold text-neutral-800">{task.name}</h2>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
          aria-label="Close dependencies panel"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex flex-col gap-4 px-4 py-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Waits for ({predecessors.length})
          </div>
          {predecessors.length === 0 ? (
            <p className="mt-1 text-sm text-neutral-400">Nothing — this task can start as soon as the schedule allows.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {predecessors.map((d) => renderRow(d, d.predecessor_task_id, "to"))}
            </ul>
          )}
        </div>

        <div className="border-t border-neutral-200 pt-3">
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Blocks ({successors.length})
          </div>
          {successors.length === 0 ? (
            <p className="mt-1 text-sm text-neutral-400">Nothing depends on this task yet.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {successors.map((d) => renderRow(d, d.successor_task_id, "from"))}
            </ul>
          )}
        </div>

        {canEdit && (
          <div className="flex flex-col gap-3 border-t border-neutral-200 pt-4">
            <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Add a predecessor
            </div>
            <Select
              label="This task waits for"
              placeholder="— choose a task —"
              options={options.map((t) => ({ value: t.task_id, label: t.name }))}
              value={predecessorId}
              onChange={(e) => setPredecessorId(e.target.value)}
              helperText={
                options.length === 0
                  ? "No eligible tasks — every other task already depends on this one, directly or indirectly."
                  : undefined
              }
            />
            <Select
              label="Relationship"
              options={schedulingApi.DEPENDENCY_TYPES.map((d) => ({ value: d.value, label: d.label }))}
              value={dependencyType}
              onChange={(e) => setDependencyType(e.target.value as DependencyType)}
              helperText={schedulingApi.DEPENDENCY_TYPES.find((d) => d.value === dependencyType)?.hint}
            />
            <TextInput
              label="Lag (working days)"
              type="number"
              step="0.5"
              value={lagDays}
              onChange={(e) => setLagDays(e.target.value)}
              helperText="Negative for lead time. Measured in working days, so it skips non-working days exactly as duration does."
            />
            <button
              onClick={() => {
                onAdd({
                  predecessorTaskId: predecessorId,
                  successorTaskId: task.task_id,
                  dependencyType,
                  lagHours: Number(lagDays) * HOURS_PER_WORKING_DAY,
                });
                setPredecessorId("");
                setLagDays("0");
              }}
              disabled={isSaving || predecessorId === ""}
              className="w-fit rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isSaving ? "Linking..." : "Add dependency"}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
