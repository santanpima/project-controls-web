import { useState } from "react";
import { Modal } from "@shared/components/Modal";
import { TextInput } from "@shared/components/TextInput";
import { Select } from "@shared/components/Select";
import * as schedulingApi from "@shared/api/scheduling";
import type { ActivityType, ConstraintType, ScheduleTask } from "@shared/api/scheduling";
import type { WbsElement } from "@shared/api/wbs";
import { HOURS_PER_WORKING_DAY, toNumber } from "./schedule-logic";

// 12.2.1.1.1 — the raw, editable fields of a task. Deliberately does not offer
// early/late dates, float or criticality: those are CPM outputs (12.3.1.1.1–3)
// that the engine computes and the update endpoint refuses to write, so
// showing them as inputs would promise something the backend won't honour.

interface TaskFormModalProps {
  task: ScheduleTask | null; // null = creating
  wbsElements: WbsElement[];
  isSaving: boolean;
  onClose: () => void;
  onCreate: (input: Omit<schedulingApi.CreateTaskInput, "projectId">) => void;
  onUpdate: (fields: schedulingApi.TaskEditableFields) => void;
}

export function TaskFormModal({
  task, wbsElements, isSaving, onClose, onCreate, onUpdate,
}: TaskFormModalProps): JSX.Element {
  const [name, setName] = useState(task?.name ?? "");
  const [wbsId, setWbsId] = useState(task?.wbs_id ?? "");
  const [activityType, setActivityType] = useState<ActivityType>(task?.activity_type ?? "task");
  // Durations are entered in working days because that's how people plan, and
  // converted to the working hours the engine actually walks.
  const [durationDays, setDurationDays] = useState(() => {
    const hours = toNumber(task?.duration_hours ?? null);
    return hours === null ? "1" : String(hours / HOURS_PER_WORKING_DAY);
  });
  const [percentComplete, setPercentComplete] = useState(
    task?.percent_complete === null || task?.percent_complete === undefined ? "" : String(toNumber(task.percent_complete))
  );
  const [constraintType, setConstraintType] = useState<ConstraintType>(task?.constraint_type ?? "ASAP");
  const [constraintDate, setConstraintDate] = useState(task?.constraint_date?.slice(0, 10) ?? "");

  const isMilestone = activityType === "milestone";
  const needsDate = schedulingApi.constraintNeedsDate(constraintType);
  const durationValue = isMilestone ? 0 : Number(durationDays) * HOURS_PER_WORKING_DAY;

  // The backend rejects a non-milestone with no positive duration outright, so
  // the form refuses it here rather than letting the request fail.
  const durationValid = isMilestone || (Number.isFinite(durationValue) && durationValue > 0);
  const dateValid = !needsDate || constraintDate !== "";
  const canSubmit = name.trim() !== "" && wbsId !== "" && durationValid && dateValid;

  function submit() {
    if (task) {
      onUpdate({
        name: name.trim(),
        duration_hours: durationValue,
        activity_type: activityType,
        percent_complete: percentComplete === "" ? null : Number(percentComplete),
        constraint_type: constraintType,
        constraint_date: needsDate ? constraintDate : null,
      });
      return;
    }
    onCreate({
      wbsId,
      name: name.trim(),
      durationHours: durationValue,
      activityType,
      percentComplete: percentComplete === "" ? null : Number(percentComplete),
      constraintType,
      constraintDate: needsDate ? constraintDate : null,
    });
  }

  return (
    <Modal open onClose={onClose} title={task ? `Edit ${task.name}` : "New task"}>
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
        <TextInput label="Task name" required value={name} onChange={(e) => setName(e.target.value)} />

        <Select
          label="WBS element"
          required
          placeholder="— choose where this work sits —"
          options={wbsElements.map((w) => ({ value: w.wbs_id, label: `${w.code}  ${w.name}` }))}
          value={wbsId}
          // A task's WBS position is set at creation and not changed here: the
          // backend caches each task's nearest work-package ancestor when it's
          // created, and moving it would leave that cache stale.
          disabled={!!task}
          onChange={(e) => setWbsId(e.target.value)}
          helperText={
            task
              ? "A task's WBS position is fixed once created."
              : "Every task belongs to a WBS element — that's what connects the schedule to the work breakdown."
          }
        />

        <Select
          label="Activity type"
          options={schedulingApi.ACTIVITY_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          value={activityType}
          onChange={(e) => setActivityType(e.target.value as ActivityType)}
          helperText={schedulingApi.ACTIVITY_TYPES.find((t) => t.value === activityType)?.hint}
        />

        {!isMilestone && (
          <TextInput
            label="Duration (working days)"
            required
            type="number"
            min="0"
            step="0.5"
            value={durationDays}
            onChange={(e) => setDurationDays(e.target.value)}
            error={durationValid ? undefined : "A task needs a duration greater than zero."}
            helperText="Counted in working days — the engine skips non-working days using this task's calendar."
          />
        )}

        <TextInput
          label="Percent complete"
          type="number"
          min="0"
          max="100"
          value={percentComplete}
          onChange={(e) => setPercentComplete(e.target.value)}
          helperText="Leave blank if progress hasn't been assessed — blank means unreported, not zero."
        />

        <Select
          label="Constraint"
          options={schedulingApi.CONSTRAINT_TYPES.map((c) => ({ value: c.value, label: c.label }))}
          value={constraintType}
          onChange={(e) => setConstraintType(e.target.value as ConstraintType)}
          helperText="As soon as possible is the normal case — the others pin the task to a date."
        />

        {needsDate && (
          <TextInput
            label="Constraint date"
            required
            type="date"
            value={constraintDate}
            onChange={(e) => setConstraintDate(e.target.value)}
            error={dateValid ? undefined : "This constraint type needs a date."}
            helperText="A hard date that fights the dependencies produces negative float — reported, never silently resolved."
          />
        )}

        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={isSaving || !canSubmit}
            className="rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSaving ? "Saving..." : task ? "Save changes" : "Create task"}
          </button>
          <button
            onClick={onClose}
            className="rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
