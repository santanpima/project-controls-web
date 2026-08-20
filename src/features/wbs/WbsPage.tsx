import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown, ChevronRight, Plus, ListTree, AlertTriangle, Info, X,
} from "lucide-react";
import { useAuth } from "@shared/auth/AuthContext";
import { readOnlyReason } from "@shared/auth/permissions";
import { Modal } from "@shared/components/Modal";
import { TextInput } from "@shared/components/TextInput";
import { TextArea } from "@shared/components/TextArea";
import { Select } from "@shared/components/Select";
import * as wbsApi from "@shared/api/wbs";
import type { WbsElement, WbsEditableFields, WbsStatus } from "@shared/api/wbs";
import { buildTree, flattenVisible, idsWithChildren } from "./wbs-tree";
import { WbsDictionaryPanel, WbsStatusBadge } from "./WbsDictionaryPanel";

// 7.1.1.2.1 (tree/outline view) + 7.1.2.1.2 (dictionary side-panel) — the
// first real WBS screen, against the Theme 7 backend that has been fully
// built and deployed since well before any frontend existed.
//
// What this screen deliberately does NOT do, so it isn't mistaken for
// complete: drag-and-drop reordering within a parent (7.1.1.2.2) is its
// own specification item and isn't built; reparenting is offered instead,
// through an explicit control in the panel. Baselines and change-request
// approval (7.1.2.2.x) have a real backend but no screen yet — this screen
// only surfaces the one place they become visible in ordinary use: an edit
// that gets held for approval instead of applying.

type Notice = { kind: "info" | "warning" | "error"; text: string } | null;

const NOTICE_STYLES = {
  info: "border-status-info/30 bg-status-info/5 text-status-info",
  warning: "border-status-warning/30 bg-status-warning/5 text-status-warning",
  error: "border-status-error/30 bg-status-error/5 text-status-error",
};

export function WbsPage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  // 2.2.1.2.2 — what this role may actually do. The API enforces this
  // regardless; this only decides what's worth showing.
  const { user, can } = useAuth();
  const canCreate = can("wbs", "create");
  const canUpdate = can("wbs", "update");
  const canDelete = can("wbs", "delete");
  const readOnly = !canCreate && !canUpdate && !canDelete;

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [createUnder, setCreateUnder] = useState<{ parent: WbsElement | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WbsElement | null>(null);
  const didAutoExpand = useRef(false);

  const elementsQuery = useQuery({
    queryKey: ["wbs", projectId],
    queryFn: () => wbsApi.listWbsElements(projectId as string),
    enabled: !!projectId,
  });

  // Both generics are stated explicitly rather than inferred: the tree
  // helpers are generic over anything WbsNodeLike-shaped, and letting them
  // infer from the query result would quietly widen every row back to that
  // minimal shape the moment the query's own typing changed.
  const elements = useMemo<WbsElement[]>(() => elementsQuery.data ?? [], [elementsQuery.data]);
  const tree = useMemo(() => buildTree<WbsElement>(elements), [elements]);
  const rows = useMemo(() => flattenVisible(tree, expandedIds), [tree, expandedIds]);
  const selected = elements.find((e) => e.wbs_id === selectedId) ?? null;

  // Expand everything on first load. A WBS is meaningless collapsed to its
  // roots — the outline IS the content — and MVP-sized trees are small
  // enough that this is the useful default rather than a performance
  // problem. Only ever done once, so a person's own collapsing isn't
  // undone by a background refetch.
  useEffect(() => {
    if (didAutoExpand.current || elements.length === 0) return;
    setExpandedIds(idsWithChildren(elements));
    didAutoExpand.current = true;
  }, [elements]);

  function invalidateTree() {
    queryClient.invalidateQueries({ queryKey: ["wbs", projectId] });
  }

  // 7.1.2.2.3 — the one place baseline gating becomes visible in ordinary
  // use: the edit didn't apply, it became a change request awaiting someone
  // else's approval. Reported plainly rather than shown as a success.
  function reportWrite(result: wbsApi.MaybeGated<WbsElement>, successText: string) {
    if (wbsApi.isGated(result)) {
      setNotice({
        kind: "info",
        text:
          `This project has an approved WBS baseline, so the change wasn't applied directly — ` +
          `it was submitted as change request #${result.changeRequest.change_request_id}, ` +
          `which someone other than you has to approve.`,
      });
      return;
    }
    setNotice({ kind: "info", text: successText });
    invalidateTree();
  }

  function reportError(error: unknown) {
    setNotice({
      kind: "error",
      text: error instanceof Error ? error.message : "Something went wrong with that request.",
    });
  }

  const updateMutation = useMutation({
    mutationFn: (vars: { wbsId: string; fields: WbsEditableFields }) =>
      wbsApi.updateWbsElement(vars.wbsId, vars.fields, "Dictionary edit from the WBS screen"),
    onSuccess: (result) => reportWrite(result, "Dictionary entry saved."),
    onError: reportError,
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { wbsId: string; status: WbsStatus }) =>
      wbsApi.setWbsStatus(vars.wbsId, vars.status),
    onSuccess: (result) => {
      setNotice(
        result.warning
          ? { kind: "warning", text: result.warning }
          : { kind: "info", text: `Status set to ${result.element.status}.` }
      );
      invalidateTree();
    },
    onError: reportError,
  });

  const moveMutation = useMutation({
    mutationFn: (vars: { wbsId: string; newParentWbsId: string | null }) =>
      wbsApi.moveWbsElement(vars.wbsId, vars.newParentWbsId, "Reparent from the WBS screen"),
    onSuccess: (result) => reportWrite(result, "Element moved and renumbered."),
    onError: reportError,
  });

  const createMutation = useMutation({
    mutationFn: (input: wbsApi.CreateWbsElementInput) =>
      wbsApi.createWbsElement(input, "New element from the WBS screen"),
    onSuccess: (result) => {
      setCreateUnder(null);
      reportWrite(result, "Element created.");
    },
    onError: reportError,
  });

  const deleteMutation = useMutation({
    mutationFn: (wbsId: string) => wbsApi.deleteWbsElement(wbsId),
    onSuccess: (_result, wbsId) => {
      setPendingDelete(null);
      if (selectedId === wbsId) setSelectedId(null);
      setNotice({ kind: "info", text: "Element deleted." });
      invalidateTree();
    },
    onError: (error) => {
      setPendingDelete(null);
      reportError(error);
    },
  });

  const isSaving =
    updateMutation.isPending || statusMutation.isPending || moveMutation.isPending ||
    createMutation.isPending || deleteMutation.isPending;

  function toggleExpanded(wbsId: string) {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(wbsId)) next.delete(wbsId);
      else next.add(wbsId);
      return next;
    });
  }

  if (elementsQuery.isLoading) {
    return <div className="text-sm text-neutral-500">Loading work breakdown structure...</div>;
  }
  if (elementsQuery.isError) {
    return (
      <div className="rounded border border-status-error/30 bg-status-error/5 p-4 text-sm text-status-error">
        Couldn&apos;t load the WBS for this project. {(elementsQuery.error as Error)?.message}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <div className={"flex items-start gap-2 rounded border p-3 text-sm " + NOTICE_STYLES[notice.kind]}>
          {notice.kind === "warning" ? <AlertTriangle size={16} className="mt-0.5 shrink-0" /> : null}
          {notice.kind !== "warning" ? <Info size={16} className="mt-0.5 shrink-0" /> : null}
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss message">
            <X size={16} />
          </button>
        </div>
      )}

      {readOnly && (
        <div className="rounded border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
          {readOnlyReason(user?.role_name, "the work breakdown structure")} You can browse the structure and
          its dictionary entries; changing them needs a role with edit access.
        </div>
      )}

      <div className="flex flex-col gap-4 xl:flex-row">
        <section className="min-w-0 flex-1 rounded bg-white shadow-elevation-1">
          <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <ListTree size={18} className="text-brand-primary" />
              <h1 className="text-lg font-semibold text-neutral-800">Work Breakdown Structure</h1>
              <span className="text-xs text-neutral-500">
                {elements.length} element{elements.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setExpandedIds(idsWithChildren(elements))}
                className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
              >
                Expand all
              </button>
              <button
                onClick={() => setExpandedIds(new Set())}
                className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
              >
                Collapse all
              </button>
              {canCreate && (
                <button
                  onClick={() => setCreateUnder({ parent: null })}
                  className="flex items-center gap-1 rounded bg-brand-primary px-2 py-1 text-xs font-medium text-white"
                >
                  <Plus size={14} /> Top-level element
                </button>
              )}
            </div>
          </div>

          {elements.length === 0 ? (
            <div className="p-8 text-center text-sm text-neutral-500">
              This project has no WBS elements yet.{" "}
              {canCreate ? "Create a top-level element to start the structure." : ""}
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {rows.map((row) => {
                const isSelected = row.element.wbs_id === selectedId;
                return (
                  <li
                    key={row.element.wbs_id}
                    className={"flex items-center gap-1 pr-2 " + (isSelected ? "bg-brand-accent/5" : "")}
                    style={{ paddingLeft: row.depth * 20 + 8 }}
                  >
                    {row.hasChildren ? (
                      <button
                        onClick={() => toggleExpanded(row.element.wbs_id)}
                        className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
                        aria-label={row.isExpanded ? "Collapse" : "Expand"}
                        aria-expanded={row.isExpanded}
                      >
                        {row.isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    ) : (
                      <span className="inline-block w-6" />
                    )}

                    <button
                      onClick={() => setSelectedId(row.element.wbs_id)}
                      className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
                    >
                      <span className="font-mono text-xs text-neutral-500">{row.element.code}</span>
                      <span
                        className={
                          "truncate text-sm " +
                          (isSelected ? "font-medium text-brand-primary" : "text-neutral-800")
                        }
                      >
                        {row.element.name}
                      </span>
                      {row.element.is_reporting_element && (
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">
                          reporting
                        </span>
                      )}
                      <WbsStatusBadge status={row.element.status} />
                    </button>

                    {canCreate && (
                      <button
                        onClick={() => setCreateUnder({ parent: row.element })}
                        className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                        aria-label={`Add a child element under ${row.element.code}`}
                        title="Add child element"
                      >
                        <Plus size={14} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {selected && (
          <WbsDictionaryPanel
            key={selected.wbs_id}
            element={selected}
            elements={elements}
            isSaving={isSaving}
            canUpdate={canUpdate}
            canDelete={canDelete}
            onClose={() => setSelectedId(null)}
            onSave={(fields) => updateMutation.mutate({ wbsId: selected.wbs_id, fields })}
            onStatusChange={(status) => statusMutation.mutate({ wbsId: selected.wbs_id, status })}
            onMove={(newParentWbsId) => moveMutation.mutate({ wbsId: selected.wbs_id, newParentWbsId })}
            onDelete={() => setPendingDelete(selected)}
          />
        )}
      </div>

      <CreateElementModal
        open={createUnder !== null}
        parent={createUnder?.parent ?? null}
        isSaving={createMutation.isPending}
        onClose={() => setCreateUnder(null)}
        onCreate={(input) =>
          createMutation.mutate({
            ...input,
            projectId: projectId as string,
            parentWbsId: createUnder?.parent?.wbs_id ?? null,
          })
        }
      />

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete this WBS element?"
      >
        <p className="text-sm text-neutral-700">
          {pendingDelete?.code} {pendingDelete?.name} will be removed from the structure. Elements with
          children can&apos;t be deleted — the database refuses those outright.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete.wbs_id)}
            disabled={deleteMutation.isPending}
            className="rounded bg-status-error px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete element"}
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

type CreateInput = Omit<wbsApi.CreateWbsElementInput, "projectId" | "parentWbsId">;

interface CreateElementModalProps {
  open: boolean;
  parent: WbsElement | null;
  isSaving: boolean;
  onClose: () => void;
  onCreate: (input: CreateInput) => void;
}

// The WBS code itself is deliberately not an input here: the backend
// assigns it from the new element's position among its siblings
// (service.js's childCode), and letting a screen propose one would just
// invite a number that disagrees with the server's own scheme.
function CreateElementModal({
  open, parent, isSaving, onClose, onCreate,
}: CreateElementModalProps): JSX.Element {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [isReportingElement, setIsReportingElement] = useState(false);

  // Reset whenever the modal opens for a different parent, so yesterday's
  // half-typed element never leaks into a new one.
  useEffect(() => {
    if (open) {
      setName("");
      setCategory("");
      setDescription("");
      setIsReportingElement(false);
    }
  }, [open, parent?.wbs_id]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={parent ? `New element under ${parent.code} ${parent.name}` : "New top-level element"}
    >
      <div className="flex flex-col gap-4">
        <TextInput
          label="Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          helperText="The WBS code is assigned by the server from this element's position."
        />
        <Select
          label="Category"
          placeholder="— none —"
          options={wbsApi.WBS_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={isReportingElement}
            onChange={(e) => setIsReportingElement(e.target.checked)}
          />
          Reporting element
        </label>
        <TextArea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          helperText="The rest of the dictionary can be filled in from the panel afterward."
        />
        <div className="flex gap-2">
          <button
            onClick={() =>
              onCreate({
                name: name.trim(),
                category: category === "" ? null : (category as wbsApi.WbsCategory),
                isReportingElement,
                description: description.trim() === "" ? null : description.trim(),
              })
            }
            disabled={isSaving || name.trim() === ""}
            className="rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSaving ? "Creating..." : "Create element"}
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
