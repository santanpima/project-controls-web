import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, X, Link2, Link2Off, Trash2, CornerDownRight } from "lucide-react";
import { Tabs } from "@shared/components/Tabs";
import { TextInput } from "@shared/components/TextInput";
import { TextArea } from "@shared/components/TextArea";
import { Select } from "@shared/components/Select";
import * as wbsApi from "@shared/api/wbs";
import * as obsApi from "@shared/api/obs";
import type { WbsElement, WbsEditableFields, WbsStatus } from "@shared/api/wbs";
import { validMoveTargets } from "./wbs-tree";

// 7.1.2.1.2 — the WBS dictionary entry side-panel. Shows the selected
// element's full dictionary (7.1.1.1.3 + 7.1.2.1.1), its status lifecycle
// control (7.1.2.1.3), its control-account linkage indicator (also
// 7.1.2.1.3), and the structural operations that aren't drag-and-drop
// (move/reparent, delete).
//
// Deliberately presentational about *writing*: every mutation is handed
// back up to WbsPage through these callbacks rather than fired from here,
// so there's exactly one place that knows how to invalidate the tree query
// and how to interpret a baseline-gated 202 response.

interface WbsDictionaryPanelProps {
  element: WbsElement;
  elements: WbsElement[];
  onSave: (fields: WbsEditableFields) => void;
  onStatusChange: (status: WbsStatus) => void;
  onMove: (newParentWbsId: string | null) => void;
  onDelete: () => void;
  onClose: () => void;
  isSaving: boolean;
  // 2.2.1.2.2 — decided by WbsPage from the signed-in role, passed down
  // rather than re-derived here, so one screen has one answer.
  canUpdate: boolean;
  canDelete: boolean;
}

// The five dictionary fields, in the order the specification lists them.
const DICTIONARY_FIELDS: { key: keyof WbsEditableFields; label: string; helper: string }[] = [
  { key: "description", label: "Description", helper: "What this element covers, in plain terms." },
  { key: "scope", label: "Scope", helper: "What work is included." },
  { key: "deliverable", label: "Deliverable", helper: "What this element produces." },
  { key: "exclusions", label: "Exclusions", helper: "What is deliberately NOT included." },
  { key: "acceptance_criteria", label: "Acceptance Criteria", helper: "How completion is judged." },
];

const STATUS_STYLES: Record<WbsStatus, string> = {
  planned: "bg-neutral-100 text-neutral-600",
  active: "bg-status-info/10 text-status-info",
  complete: "bg-status-success/10 text-status-success",
};

export function WbsStatusBadge({ status }: { status: WbsStatus }): JSX.Element {
  return (
    <span className={"rounded px-1.5 py-0.5 text-xs font-medium " + STATUS_STYLES[status]}>
      {status}
    </span>
  );
}

export function WbsDictionaryPanel({
  element, elements, onSave, onStatusChange, onMove, onDelete, onClose, isSaving, canUpdate, canDelete,
}: WbsDictionaryPanelProps): JSX.Element {
  const [tab, setTab] = useState("dictionary");
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<WbsEditableFields>({});
  const [moveTargetId, setMoveTargetId] = useState("");

  // 7.1.2.1.3 — the real check against the control_account table, not a
  // stub. Fetched per selected element rather than for the whole tree at
  // once: there's no bulk endpoint for it, and one small request when a
  // person actually opens an element beats N requests to render a tree.
  const controlAccountQuery = useQuery({
    queryKey: ["wbs-control-account", element.wbs_id],
    queryFn: () => wbsApi.getControlAccountStatus(element.wbs_id),
  });

  // 8.2.1.1.1 — the organizations this element can be made the responsibility
  // of. Cached under the same key the OBS screen uses, so opening this panel
  // after visiting that screen costs nothing.
  const orgsQuery = useQuery({
    queryKey: ["obs", element.project_id],
    queryFn: () => obsApi.listOrgs(element.project_id),
  });

  // Only the fields actually touched get sent — an untouched dictionary
  // field is left alone entirely rather than rewritten with its own
  // current value, so the audit trail records real edits, not no-ops.
  function fieldValue(key: keyof WbsEditableFields): string {
    const drafted = draft[key];
    if (drafted !== undefined) return (drafted as string | null) ?? "";
    const current = element[key as keyof WbsElement];
    return current === null || current === undefined ? "" : String(current);
  }

  function setField(key: keyof WbsEditableFields, value: string) {
    setDraft((previous) => ({ ...previous, [key]: value === "" ? null : value }));
  }

  function startEditing() {
    setDraft({});
    setIsEditing(true);
  }

  function cancelEditing() {
    setDraft({});
    setIsEditing(false);
  }

  function submit() {
    onSave(draft);
    setIsEditing(false);
    setDraft({});
  }

  const moveTargets = validMoveTargets(elements, element.wbs_id);
  const hasEdits = Object.keys(draft).length > 0;

  return (
    <aside className="rounded bg-white shadow-elevation-1 xl:w-[420px] xl:shrink-0">
      <div className="flex items-start justify-between gap-2 border-b border-neutral-200 px-4 py-3">
        <div className="min-w-0">
          <div className="font-mono text-xs text-neutral-500">{element.code}</div>
          <h2 className="truncate text-lg font-semibold text-neutral-800">{element.name}</h2>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
          aria-label="Close dictionary panel"
        >
          <X size={18} />
        </button>
      </div>

      <div className="px-4 pt-2">
        <Tabs
          tabs={[
            { key: "dictionary", label: "Dictionary" },
            { key: "structure", label: "Structure" },
          ]}
          activeKey={tab}
          onChange={setTab}
        />
      </div>

      {tab === "dictionary" && (
        <div className="flex flex-col gap-4 px-4 py-4">
          <div className="flex items-center justify-between">
            <Select
              label="Status"
              disabled={isSaving || !canUpdate}
              options={wbsApi.WBS_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
              value={element.status}
              onChange={(e) => onStatusChange(e.target.value as WbsStatus)}
              helperText="Completing a parent with unfinished children warns, but is allowed."
              className="w-full"
            />
          </div>

          {isEditing ? (
            <>
              <TextInput
                label="Name"
                required
                value={fieldValue("name")}
                onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
              />
              <Select
                label="Category"
                placeholder="— none —"
                options={wbsApi.WBS_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
                value={fieldValue("category")}
                onChange={(e) => setField("category", e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={
                    draft.is_reporting_element !== undefined
                      ? draft.is_reporting_element
                      : element.is_reporting_element
                  }
                  onChange={(e) => setDraft((p) => ({ ...p, is_reporting_element: e.target.checked }))}
                />
                Reporting element
              </label>
              <Select
                label="Responsible organization"
                placeholder="— none —"
                options={(orgsQuery.data ?? []).map((o) => ({
                  value: o.org_id,
                  label: `${o.org_code}  ${o.name}`,
                }))}
                value={fieldValue("responsible_obs_id")}
                onChange={(e) => setField("responsible_obs_id", e.target.value)}
                helperText="The organization accountable for this element. Optional — an element can sit unassigned during early planning. It is also what puts an organization on the Responsibility Matrix."
              />
              {DICTIONARY_FIELDS.map((field) => (
                <TextArea
                  key={String(field.key)}
                  label={field.label}
                  helperText={field.helper}
                  value={fieldValue(field.key)}
                  onChange={(e) => setField(field.key, e.target.value)}
                />
              ))}
              <div className="flex gap-2">
                <button
                  onClick={submit}
                  disabled={isSaving || !hasEdits}
                  className="rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {isSaving ? "Saving..." : "Save changes"}
                </button>
                <button
                  onClick={cancelEditing}
                  className="rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <dl className="flex flex-col gap-3">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">Category</dt>
                  <dd className="text-sm text-neutral-800">
                    {wbsApi.WBS_CATEGORIES.find((c) => c.value === element.category)?.label ?? (
                      <span className="text-neutral-400">Not set</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Reporting element
                  </dt>
                  <dd className="text-sm text-neutral-800">{element.is_reporting_element ? "Yes" : "No"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Responsible organization
                  </dt>
                  <dd className="text-sm text-neutral-800">
                    {element.responsible_obs_id ? (
                      (() => {
                        const org = (orgsQuery.data ?? []).find(
                          (o) => o.org_id === element.responsible_obs_id
                        );
                        return org ? `${org.org_code}  ${org.name}` : "Set, but not in this project";
                      })()
                    ) : (
                      <span className="text-neutral-400">Not set</span>
                    )}
                  </dd>
                </div>
                {DICTIONARY_FIELDS.map((field) => {
                  const value = element[field.key as keyof WbsElement] as string | null;
                  return (
                    <div key={String(field.key)}>
                      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                        {field.label}
                      </dt>
                      <dd className="whitespace-pre-wrap text-sm text-neutral-800">
                        {value ? value : <span className="text-neutral-400">Not set</span>}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              {canUpdate && (
                <button
                  onClick={startEditing}
                  className="flex w-fit items-center gap-1.5 rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
                >
                  <Pencil size={14} /> Edit dictionary entry
                </button>
              )}
            </>
          )}
        </div>
      )}

      {tab === "structure" && (
        <div className="flex flex-col gap-4 px-4 py-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Control account
            </div>
            {controlAccountQuery.isLoading ? (
              <div className="text-sm text-neutral-500">Checking...</div>
            ) : controlAccountQuery.isError ? (
              <div className="text-sm text-status-error">Couldn&apos;t check control-account linkage.</div>
            ) : controlAccountQuery.data?.linked ? (
              <div className="mt-1 flex items-center gap-1.5 text-sm text-status-success">
                <Link2 size={14} /> Linked to a control account
              </div>
            ) : (
              <div className="mt-1 flex items-center gap-1.5 text-sm text-neutral-500">
                <Link2Off size={14} /> Not linked to a control account
              </div>
            )}
          </div>

          <div className="border-t border-neutral-200 pt-4">
            <Select
              label="Move under"
              disabled={!canUpdate}
              placeholder="— top level (no parent) —"
              options={moveTargets.map((t) => ({ value: t.wbs_id, label: `${t.code}  ${t.name}` }))}
              value={moveTargetId}
              onChange={(e) => setMoveTargetId(e.target.value)}
              helperText="The element and its whole subtree are renumbered by the server after a move."
            />
            <button
              onClick={() => onMove(moveTargetId === "" ? null : moveTargetId)}
              disabled={isSaving || !canUpdate || (moveTargetId === "" && element.parent_wbs_id === null)}
              className="mt-2 flex items-center gap-1.5 rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              <CornerDownRight size={14} /> Move element
            </button>
            <p className="mt-2 text-xs text-neutral-500">
              Reordering by dragging within the same parent (7.1.1.2.2) isn&apos;t built yet — this moves an
              element to a different parent, which is a separate operation.
            </p>
          </div>

          <div className={"border-t border-neutral-200 pt-4 " + (canDelete ? "" : "hidden")}>
            <button
              onClick={onDelete}
              disabled={isSaving || !canDelete}
              className="flex items-center gap-1.5 rounded border border-status-error/40 px-3 py-2 text-sm text-status-error hover:bg-status-error/5 disabled:opacity-50"
            >
              <Trash2 size={14} /> Delete element
            </button>
            <p className="mt-2 text-xs text-neutral-500">
              An element with children can&apos;t be deleted — the database refuses it, and that refusal is
              shown rather than worked around.
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}
