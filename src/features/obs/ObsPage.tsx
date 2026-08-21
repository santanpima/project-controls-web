import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown, ChevronRight, Plus, Users2, Pencil, Trash2, Download, Upload, Info, X, LayoutGrid,
} from "lucide-react";
import { useAuth } from "@shared/auth/AuthContext";
import { readOnlyReason } from "@shared/auth/permissions";
import { Modal } from "@shared/components/Modal";
import { TextInput } from "@shared/components/TextInput";
import { Select } from "@shared/components/Select";
import * as obsApi from "@shared/api/obs";
import type { OrgElement, OrgType } from "@shared/api/obs";
import {
  buildTree, flattenVisible, idsWithChildren, validMoveTargets,
} from "@shared/tree/hierarchy";
import type { HierarchyAccessors } from "@shared/tree/hierarchy";
import { ObsCsvDialog } from "./ObsCsvDialog";

// 8.1.1.1.3 / 8.1.1.2.1 — the OBS org chart screen, built on the same shared
// hierarchy logic as the WBS tree, exactly as the specification anticipated.
//
// Three real differences from the WBS screen, all of them the specification's
// own rather than shortcuts: an organization has no long-text dictionary, so
// its whole attribute set fits in the row and there's no detail panel; there
// is no baseline or change-request gating, so an edit applies immediately; and
// there is no drag-and-drop reorganization item for OBS at all — reparenting
// happens through the parent field on the edit form, which is where 8.1.1.1.3
// says it belongs.

// Organization codes are free-form identifiers a company chooses (ENG, QA-2,
// SUB-ACME), not the generated dotted numbers WBS uses, so plain locale-aware
// string ordering is the right comparison here.
const accessors: HierarchyAccessors<OrgElement> = {
  getId: (o) => o.org_id,
  getParentId: (o) => o.parent_obs_id,
  compare: (a, b) => a.org_code.localeCompare(b.org_code),
};

const TYPE_STYLES: Record<OrgType, string> = {
  internal: "bg-status-info/10 text-status-info",
  subcontractor: "bg-status-warning/10 text-status-warning",
  vendor: "bg-neutral-100 text-neutral-600",
  government_customer: "bg-brand-accent/10 text-brand-accent",
};

function OrgTypeBadge({ type }: { type: OrgType | null }): JSX.Element {
  if (!type) return <span className="text-xs text-neutral-400">no type</span>;
  const label = obsApi.ORG_TYPES.find((t) => t.value === type)?.label ?? type;
  return <span className={"rounded px-1.5 py-0.5 text-xs font-medium " + TYPE_STYLES[type]}>{label}</span>;
}

type Notice = { kind: "info" | "error"; text: string } | null;

export function ObsPage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  // 2.2.1.2.2 — the same capability check the WBS screen makes, against this
  // module's own grants: a scheduler, for instance, edits WBS but only reads
  // OBS, so the two screens genuinely differ for the same person.
  const { user, can } = useAuth();
  const canCreate = can("obs", "create");
  const canUpdate = can("obs", "update");
  const canDelete = can("obs", "delete");
  const readOnly = !canCreate && !canUpdate && !canDelete;

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<{ org: OrgElement | null; parent: OrgElement | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<OrgElement | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [importFailure, setImportFailure] = useState<obsApi.ImportFailure | null>(null);
  const didAutoExpand = useRef(false);

  const orgsQuery = useQuery({
    queryKey: ["obs", projectId],
    queryFn: () => obsApi.listOrgs(projectId as string),
    enabled: !!projectId,
  });

  const orgs = useMemo<OrgElement[]>(() => orgsQuery.data ?? [], [orgsQuery.data]);
  const tree = useMemo(() => buildTree(orgs, accessors), [orgs]);
  const rows = useMemo(() => flattenVisible(tree, expandedIds, accessors), [tree, expandedIds]);

  // Expanded by default on first load, for the same reason as WBS: an org
  // chart collapsed to its roots shows almost nothing. Only ever done once, so
  // a person's own collapsing survives a background refetch.
  useEffect(() => {
    if (didAutoExpand.current || orgs.length === 0) return;
    setExpandedIds(idsWithChildren(orgs, accessors));
    didAutoExpand.current = true;
  }, [orgs]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["obs", projectId] });
  }

  function reportError(error: unknown) {
    setNotice({
      kind: "error",
      text: error instanceof Error ? error.message : "Something went wrong with that request.",
    });
  }

  const saveMutation = useMutation({
    mutationFn: async (vars: {
      org: OrgElement | null;
      parent: OrgElement | null;
      fields: { orgCode: string; name: string; type: OrgType | null };
    }) => {
      if (!vars.org) {
        return obsApi.createOrg({
          projectId: projectId as string,
          parentObsId: vars.parent?.org_id ?? null,
          orgCode: vars.fields.orgCode,
          name: vars.fields.name,
          type: vars.fields.type,
        });
      }
      // Attributes and position are two different endpoints on this feature —
      // update never touches parent_obs_id — so an edit that changes both
      // makes both calls rather than silently dropping one.
      const updated = await obsApi.updateOrg(vars.org.org_id, {
        org_code: vars.fields.orgCode,
        name: vars.fields.name,
        type: vars.fields.type,
      });
      const newParentId = vars.parent?.org_id ?? null;
      if (newParentId !== vars.org.parent_obs_id) {
        return obsApi.moveOrg(vars.org.org_id, newParentId);
      }
      return updated;
    },
    onSuccess: (_result, vars) => {
      setEditing(null);
      setNotice({ kind: "info", text: vars.org ? "Organization saved." : "Organization created." });
      invalidate();
    },
    onError: reportError,
  });

  const deleteMutation = useMutation({
    mutationFn: (orgId: string) => obsApi.deleteOrg(orgId),
    onSuccess: () => {
      setPendingDelete(null);
      setNotice({ kind: "info", text: "Organization deleted." });
      invalidate();
    },
    onError: (error) => {
      setPendingDelete(null);
      reportError(error);
    },
  });

  const importMutation = useMutation({
    mutationFn: (csv: string) => obsApi.importOrgsCsv(projectId as string, csv),
    onSuccess: (result) => {
      if (result.failure) {
        setImportFailure(result.failure);
        return;
      }
      setImportFailure(null);
      setCsvOpen(false);
      setNotice({
        kind: "info",
        text: `Imported ${result.created.length} organization${result.created.length === 1 ? "" : "s"}.`,
      });
      invalidate();
    },
    onError: reportError,
  });

  const exportMutation = useMutation({
    mutationFn: () => obsApi.exportOrgsCsv(projectId as string),
    onSuccess: (csv) => {
      // Handing the file to the browser directly, rather than pointing a link
      // at the endpoint: the export requires an Authorization header, which a
      // plain <a href> can't send.
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `obs-${projectId}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    },
    onError: reportError,
  });

  const isBusy = saveMutation.isPending || deleteMutation.isPending || importMutation.isPending;

  function toggleExpanded(orgId: string) {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(orgId)) next.delete(orgId);
      else next.add(orgId);
      return next;
    });
  }

  if (orgsQuery.isLoading) {
    return <div className="text-sm text-neutral-500">Loading organizational breakdown structure...</div>;
  }
  if (orgsQuery.isError) {
    return (
      <div className="rounded border border-status-error/30 bg-status-error/5 p-4 text-sm text-status-error">
        Couldn&apos;t load the OBS for this project. {(orgsQuery.error as Error)?.message}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The Responsibility Assignment Matrix (Epic 8.3) is this Theme's other
          half — the same organizations, seen against the WBS. It is a route of
          its own rather than a navigation module, so it needs a way in from
          here. */}
      <div className="flex justify-end">
        <Link
          to={`/projects/${projectId}/ram`}
          className="flex items-center gap-1.5 rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          <LayoutGrid size={14} /> Responsibility Matrix
        </Link>
      </div>

      {notice && (
        <div
          className={
            "flex items-start gap-2 rounded border p-3 text-sm " +
            (notice.kind === "error"
              ? "border-status-error/30 bg-status-error/5 text-status-error"
              : "border-status-info/30 bg-status-info/5 text-status-info")
          }
        >
          <Info size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss message">
            <X size={16} />
          </button>
        </div>
      )}

      {readOnly && (
        <div className="rounded border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
          {readOnlyReason(user?.role_name, "the organizational breakdown structure")} You can browse the org
          chart and export it; changing it needs a role with edit access.
        </div>
      )}

      <section className="rounded bg-white shadow-elevation-1">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <Users2 size={18} className="text-brand-primary" />
            <h1 className="text-lg font-semibold text-neutral-800">Organizational Breakdown Structure</h1>
            <span className="text-xs text-neutral-500">
              {orgs.length} organization{orgs.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setExpandedIds(idsWithChildren(orgs, accessors))}
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
              onClick={() => { setImportFailure(null); setCsvOpen(true); }}
              className="flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
            >
              <Upload size={14} /> Import CSV
            </button>
            )}
            <button
              onClick={() => exportMutation.mutate()}
              disabled={exportMutation.isPending || orgs.length === 0}
              className="flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
            >
              <Download size={14} /> {exportMutation.isPending ? "Exporting..." : "Export CSV"}
            </button>
            {canCreate && (
              <button
                onClick={() => setEditing({ org: null, parent: null })}
                className="flex items-center gap-1 rounded bg-brand-primary px-2 py-1 text-xs font-medium text-white"
              >
                <Plus size={14} /> Top-level organization
              </button>
            )}
          </div>
        </div>

        {orgs.length === 0 ? (
          <div className="p-8 text-center text-sm text-neutral-500">
            This project has no organizations yet.{" "}
            {canCreate
              ? "Create a top-level organization, or import an existing org chart from a CSV file."
              : ""}
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {rows.map((row) => (
              <li
                key={row.element.org_id}
                className="flex items-center gap-1 pr-2"
                style={{ paddingLeft: row.depth * 20 + 8 }}
              >
                {row.hasChildren ? (
                  <button
                    onClick={() => toggleExpanded(row.element.org_id)}
                    className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
                    aria-label={row.isExpanded ? "Collapse" : "Expand"}
                    aria-expanded={row.isExpanded}
                  >
                    {row.isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                ) : (
                  <span className="inline-block w-6" />
                )}

                <div className="flex min-w-0 flex-1 items-center gap-2 py-2">
                  <span className="font-mono text-xs text-neutral-500">{row.element.org_code}</span>
                  <span className="truncate text-sm text-neutral-800">{row.element.name}</span>
                  <OrgTypeBadge type={row.element.type} />
                </div>

                {canUpdate && (
                <button
                  onClick={() => setEditing({ org: row.element, parent: null })}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  aria-label={`Edit ${row.element.org_code}`}
                  title="Edit organization"
                >
                  <Pencil size={14} />
                </button>
                )}
                {canCreate && (
                <button
                  onClick={() => setEditing({ org: null, parent: row.element })}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  aria-label={`Add a sub-organization under ${row.element.org_code}`}
                  title="Add sub-organization"
                >
                  <Plus size={14} />
                </button>
                )}
                {canDelete && (
                <button
                  onClick={() => setPendingDelete(row.element)}
                  className="rounded p-1 text-neutral-400 hover:bg-status-error/10 hover:text-status-error"
                  aria-label={`Delete ${row.element.org_code}`}
                  title="Delete organization"
                >
                  <Trash2 size={14} />
                </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <OrgFormModal
          key={editing.org?.org_id ?? `new-${editing.parent?.org_id ?? "root"}`}
          org={editing.org}
          fixedParent={editing.parent}
          orgs={orgs}
          isSaving={saveMutation.isPending}
          onClose={() => setEditing(null)}
          onSave={(fields, parent) => saveMutation.mutate({ org: editing.org, parent, fields })}
        />
      )}

      <ObsCsvDialog
        open={csvOpen}
        isImporting={importMutation.isPending}
        failure={importFailure}
        onClose={() => setCsvOpen(false)}
        onImport={(csv) => importMutation.mutate(csv)}
      />

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete this organization?"
      >
        <p className="text-sm text-neutral-700">
          {pendingDelete?.org_code} {pendingDelete?.name} will be removed from the org chart. An organization
          with sub-organizations beneath it can&apos;t be deleted — the database refuses those outright.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete.org_id)}
            disabled={isBusy}
            className="rounded bg-status-error px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete organization"}
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

interface OrgFormModalProps {
  org: OrgElement | null;              // null = creating
  fixedParent: OrgElement | null;      // set when adding beneath a specific row
  orgs: OrgElement[];
  isSaving: boolean;
  onClose: () => void;
  onSave: (
    fields: { orgCode: string; name: string; type: OrgType | null },
    parent: OrgElement | null
  ) => void;
}

// 8.1.1.2.1 — the organization creation/edit form. In edit mode the parent
// selector is a real reorganization control (8.1.1.1.2): OBS has no
// drag-and-drop task of its own, and this form is where the backlog itself
// puts reparenting.
function OrgFormModal({ org, fixedParent, orgs, isSaving, onClose, onSave }: OrgFormModalProps): JSX.Element {
  const [orgCode, setOrgCode] = useState(org?.org_code ?? "");
  const [name, setName] = useState(org?.name ?? "");
  const [type, setType] = useState<string>(org?.type ?? "");
  const [parentId, setParentId] = useState<string>(fixedParent?.org_id ?? org?.parent_obs_id ?? "");

  const parentOptions = org
    ? validMoveTargets(orgs, org.org_id, accessors)
    : orgs;

  const title = org
    ? `Edit ${org.org_code} ${org.name}`
    : fixedParent
      ? `New organization under ${fixedParent.org_code} ${fixedParent.name}`
      : "New top-level organization";

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="flex flex-col gap-4">
        <TextInput
          label="Organization code"
          required
          value={orgCode}
          onChange={(e) => setOrgCode(e.target.value)}
          helperText="A stable identifier you choose — ENG, QA, SUB-ACME. Unlike a WBS code it isn't renumbered."
        />
        <TextInput label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <Select
          label="Type"
          placeholder="— none —"
          options={obsApi.ORG_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          value={type}
          onChange={(e) => setType(e.target.value)}
        />
        {fixedParent ? (
          <p className="text-sm text-neutral-500">
            Reports to {fixedParent.org_code} {fixedParent.name}.
          </p>
        ) : (
          <Select
            label="Reports to"
            placeholder="— top level (no parent) —"
            options={parentOptions.map((o) => ({ value: o.org_id, label: `${o.org_code}  ${o.name}` }))}
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            helperText={
              org
                ? "Changing this moves the organization and everything beneath it."
                : undefined
            }
          />
        )}
        <div className="flex gap-2">
          <button
            onClick={() =>
              onSave(
                {
                  orgCode: orgCode.trim(),
                  name: name.trim(),
                  type: type === "" ? null : (type as OrgType),
                },
                fixedParent ?? orgs.find((o) => o.org_id === parentId) ?? null
              )
            }
            disabled={isSaving || orgCode.trim() === "" || name.trim() === ""}
            className="rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSaving ? "Saving..." : org ? "Save changes" : "Create organization"}
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
