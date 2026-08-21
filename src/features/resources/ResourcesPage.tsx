import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown, ChevronRight, Plus, HardHat, Package, Boxes, Layers, Pencil, Trash2, Info, X, Sparkles,
} from "lucide-react";
import { useAuth } from "@shared/auth/AuthContext";
import { readOnlyReason } from "@shared/auth/permissions";
import { Modal } from "@shared/components/Modal";
import { TextInput } from "@shared/components/TextInput";
import * as resourcesApi from "@shared/api/resources";
import * as costHierarchyApi from "@shared/api/cost-hierarchy";
import * as obsApi from "@shared/api/obs";
import type { Resource, ResourceType } from "@shared/api/resources";
import {
  buildResourceTree, flattenResourceTree, expandableKeys, cocOptions, countResources,
} from "./resource-tree";
import type { DisplayRow } from "./resource-tree";
import { ResourceFormModal } from "./ResourceFormModal";
import { ResourceDetailPanel } from "./ResourceDetailPanel";

// Theme 10 — the Resources module: the EOC/COC cost classification (Epic 10.1)
// and the resource roster hanging off it (Epic 10.2), in one tree exactly as
// 10.2.1.1.3 describes it rather than split across two screens.
//
// One thing this screen has to get right that no other screen has faced: it
// spans two permission modules. Resources are governed by "resource"; the
// EOC/COC hierarchy is governed by "cost", because that's how the routers are
// mounted. A Cost Analyst can edit the classification but not the roster; a
// role could hold the reverse. So the two are checked separately, and the
// controls for each obey their own answer.

type Notice = { kind: "info" | "error"; text: string } | null;

const TYPE_ICON: Record<ResourceType, typeof HardHat> = {
  labor: HardHat,
  material: Package,
  other: Boxes,
};

export function ResourcesPage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const { user, can } = useAuth();
  const canCreateResource = can("resource", "create");
  const canUpdateResource = can("resource", "update");
  const canDeleteResource = can("resource", "delete");
  const canEditHierarchy = can("cost", "create") || can("cost", "update");
  const canDeleteHierarchy = can("cost", "delete");
  const readOnly = !canCreateResource && !canUpdateResource && !canDeleteResource && !canEditHierarchy;

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [editingResource, setEditingResource] = useState<{ resource: Resource | null; cocId?: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Resource | null>(null);
  const [categoryForm, setCategoryForm] = useState<
    { kind: "eoc" | "coc"; eocId?: number; code: string; name: string } | null
  >(null);
  const didAutoExpand = useRef(false);

  const treeQuery = useQuery({
    queryKey: ["resource-tree", projectId],
    queryFn: () => resourcesApi.getResourceTree(projectId as string),
    enabled: !!projectId,
  });
  const resourcesQuery = useQuery({
    queryKey: ["resources", projectId],
    queryFn: () => resourcesApi.listResources(projectId as string),
    enabled: !!projectId,
  });
  const orgsQuery = useQuery({
    queryKey: ["obs", projectId],
    queryFn: () => obsApi.listOrgs(projectId as string),
    enabled: !!projectId,
  });

  const tree = useMemo(() => buildResourceTree(treeQuery.data ?? []), [treeQuery.data]);
  const rows = useMemo(() => flattenResourceTree(tree, expandedKeys), [tree, expandedKeys]);
  const classes = useMemo(() => cocOptions(tree), [tree]);
  const resources = resourcesQuery.data ?? [];
  const organizations = orgsQuery.data ?? [];
  const selectedResource = resources.find((r) => r.resource_id === selectedResourceId) ?? null;

  useEffect(() => {
    if (didAutoExpand.current || tree.length === 0) return;
    setExpandedKeys(expandableKeys(tree));
    didAutoExpand.current = true;
  }, [tree]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["resource-tree", projectId] });
    queryClient.invalidateQueries({ queryKey: ["resources", projectId] });
  }

  function reportError(error: unknown) {
    setNotice({
      kind: "error",
      text: error instanceof Error ? error.message : "Something went wrong with that request.",
    });
  }

  const saveResourceMutation = useMutation({
    mutationFn: (vars:
      | { mode: "create"; input: Omit<resourcesApi.CreateResourceInput, "projectId"> }
      | { mode: "update"; resourceId: string; fields: resourcesApi.ResourceEditableFields }) =>
      vars.mode === "create"
        ? resourcesApi.createResource({ ...vars.input, projectId: projectId as string })
        : resourcesApi.updateResource(vars.resourceId, vars.fields),
    onSuccess: (_result, vars) => {
      setEditingResource(null);
      setNotice({ kind: "info", text: vars.mode === "create" ? "Resource created." : "Resource saved." });
      invalidate();
    },
    onError: reportError,
  });

  const deleteResourceMutation = useMutation({
    mutationFn: (resourceId: string) => resourcesApi.deleteResource(resourceId),
    onSuccess: (_result, resourceId) => {
      setPendingDelete(null);
      if (selectedResourceId === resourceId) setSelectedResourceId(null);
      setNotice({ kind: "info", text: "Resource deleted." });
      invalidate();
    },
    onError: (error) => {
      setPendingDelete(null);
      reportError(error);
    },
  });

  const categoryMutation = useMutation({
    // The return type is stated explicitly because the two branches produce
    // different shapes (an Eoc has project_id, a Coc has eoc_id), and inference
    // would otherwise try to reconcile them into one.
    mutationFn: async (
      vars: { kind: "eoc" | "coc"; eocId?: number; code: string; name: string }
    ): Promise<costHierarchyApi.Eoc | costHierarchyApi.Coc> =>
      vars.kind === "eoc"
        ? costHierarchyApi.createEoc({ projectId: projectId as string, code: vars.code, name: vars.name })
        : costHierarchyApi.createCoc({ eocId: vars.eocId as number, code: vars.code, name: vars.name }),
    onSuccess: (_result, vars) => {
      setCategoryForm(null);
      setNotice({
        kind: "info",
        text: vars.kind === "eoc" ? "Element of cost created." : "Class of cost created.",
      });
      invalidate();
    },
    onError: reportError,
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: (vars: { kind: "eoc" | "coc"; id: number }) =>
      vars.kind === "eoc" ? costHierarchyApi.deleteEoc(vars.id) : costHierarchyApi.deleteCoc(vars.id),
    onSuccess: () => {
      setNotice({ kind: "info", text: "Cost category deleted." });
      invalidate();
    },
    onError: reportError,
  });

  const seedMutation = useMutation({
    mutationFn: () => costHierarchyApi.seedStandardHierarchy(projectId as string),
    onSuccess: () => {
      setNotice({
        kind: "info",
        text: "Standard cost hierarchy created — Labor, Material and Other, with their usual classes beneath.",
      });
      invalidate();
    },
    onError: reportError,
  });

  const isSaving =
    saveResourceMutation.isPending || deleteResourceMutation.isPending ||
    categoryMutation.isPending || deleteCategoryMutation.isPending || seedMutation.isPending;

  function toggleExpanded(key: string) {
    setExpandedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (treeQuery.isLoading || resourcesQuery.isLoading) {
    return <div className="text-sm text-neutral-500">Loading resources...</div>;
  }
  if (treeQuery.isError) {
    return (
      <div className="rounded border border-status-error/30 bg-status-error/5 p-4 text-sm text-status-error">
        Couldn&apos;t load resources for this project. {(treeQuery.error as Error)?.message}
      </div>
    );
  }

  function renderRow(row: DisplayRow) {
    const isResource = row.kind === "resource";
    // Narrowed here rather than inside the JSX: a `row.kind !== "resource"`
    // guard around a callback doesn't narrow the value the callback closes
    // over, since nothing promises row is unchanged by the time it runs.
    const categoryKind: "eoc" | "coc" | null = row.kind === "resource" ? null : row.kind;
    const Icon = isResource ? TYPE_ICON[(row.resource?.resource_type ?? "other") as ResourceType] : Layers;
    const isSelected = isResource && row.id === selectedResourceId;

    return (
      <li
        key={row.key}
        className={"flex items-center gap-1 pr-2 " + (isSelected ? "bg-brand-accent/5" : "")}
        style={{ paddingLeft: row.depth * 20 + 8 }}
      >
        {row.hasChildren ? (
          <button
            onClick={() => toggleExpanded(row.key)}
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
          onClick={() => isResource && setSelectedResourceId(String(row.id))}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
          disabled={!isResource}
        >
          <Icon size={14} className={isResource ? "text-neutral-400" : "text-brand-primary"} />
          {row.code && <span className="font-mono text-xs text-neutral-500">{row.code}</span>}
          <span
            className={
              "truncate text-sm " +
              (row.kind === "eoc"
                ? "font-medium text-neutral-900"
                : isSelected
                  ? "font-medium text-brand-primary"
                  : "text-neutral-800")
            }
          >
            {row.name}
          </span>
          {row.resource?.status === "inactive" && (
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">inactive</span>
          )}
        </button>

        {row.kind === "eoc" && canEditHierarchy && (
          <button
            onClick={() => setCategoryForm({ kind: "coc", eocId: Number(row.id), code: "", name: "" })}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            aria-label={`Add a class of cost under ${row.name}`}
            title="Add class of cost"
          >
            <Plus size={14} />
          </button>
        )}
        {row.kind === "coc" && canCreateResource && (
          <button
            onClick={() => setEditingResource({ resource: null, cocId: Number(row.id) })}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            aria-label={`Add a resource under ${row.name}`}
            title="Add resource"
          >
            <Plus size={14} />
          </button>
        )}
        {categoryKind && canDeleteHierarchy && !row.hasChildren && (
          <button
            onClick={() => deleteCategoryMutation.mutate({ kind: categoryKind, id: Number(row.id) })}
            className="rounded p-1 text-neutral-400 hover:bg-status-error/10 hover:text-status-error"
            aria-label={`Delete ${row.name}`}
            title="Delete cost category"
          >
            <Trash2 size={14} />
          </button>
        )}
        {isResource && canUpdateResource && (
          <button
            onClick={() => {
              const resource = resources.find((r) => r.resource_id === row.id);
              if (resource) setEditingResource({ resource });
            }}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            aria-label={`Edit ${row.name}`}
            title="Edit resource"
          >
            <Pencil size={14} />
          </button>
        )}
      </li>
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
          {readOnlyReason(user?.role_name, "resources")} You can review the roster and the cost
          classification; changing either needs a role with edit access.
        </div>
      )}

      <div className="flex flex-col gap-4 xl:flex-row">
        <section className="min-w-0 flex-1 rounded bg-white shadow-elevation-1">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <HardHat size={18} className="text-brand-primary" />
              <h1 className="text-lg font-semibold text-neutral-800">Resources</h1>
              <span className="text-xs text-neutral-500">
                {countResources(tree)} resource{countResources(tree) === 1 ? "" : "s"} across {tree.length}{" "}
                cost element{tree.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setExpandedKeys(expandableKeys(tree))}
                className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
              >
                Expand all
              </button>
              <button
                onClick={() => setExpandedKeys(new Set())}
                className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
              >
                Collapse all
              </button>
              {canEditHierarchy && (
                <button
                  onClick={() => setCategoryForm({ kind: "eoc", code: "", name: "" })}
                  className="flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
                >
                  <Plus size={14} /> Element of cost
                </button>
              )}
              {canCreateResource && classes.length > 0 && (
                <button
                  onClick={() => setEditingResource({ resource: null })}
                  className="flex items-center gap-1 rounded bg-brand-primary px-2 py-1 text-xs font-medium text-white"
                >
                  <Plus size={14} /> New resource
                </button>
              )}
            </div>
          </div>

          {tree.length === 0 ? (
            <div className="p-8 text-center text-sm text-neutral-500">
              <p>
                This project has no cost hierarchy yet, and every resource is classified beneath one. Normally
                it&apos;s created automatically when a project is made.
              </p>
              {canEditHierarchy && (
                <button
                  onClick={() => seedMutation.mutate()}
                  disabled={isSaving}
                  className="mt-3 inline-flex items-center gap-1.5 rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  <Sparkles size={14} />
                  {seedMutation.isPending ? "Creating..." : "Create the standard hierarchy"}
                </button>
              )}
            </div>
          ) : (
            <>
              <ul className="divide-y divide-neutral-100">{rows.map(renderRow)}</ul>
              {organizations.length === 0 && (
                <div className="border-t border-neutral-100 px-4 py-3 text-xs text-neutral-500">
                  A resource needs an owning organization, and this project has none yet. Build the{" "}
                  <Link to={`/projects/${projectId}/obs`} className="text-brand-accent underline">
                    organizational breakdown structure
                  </Link>{" "}
                  first.
                </div>
              )}
            </>
          )}
        </section>

        {selectedResource && (
          <ResourceDetailPanel
            key={selectedResource.resource_id}
            resource={selectedResource}
            organizations={organizations}
            canUpdate={canUpdateResource}
            canDelete={canDeleteResource}
            isSaving={isSaving}
            onClose={() => setSelectedResourceId(null)}
            onEdit={() => setEditingResource({ resource: selectedResource })}
            onDelete={() => setPendingDelete(selectedResource)}
            onAddRateEntry={(input) =>
              resourcesApi
                .createRateEntry({ ...input, projectId: projectId as string })
                .then(() => {
                  setNotice({ kind: "info", text: "Rate entry added." });
                  queryClient.invalidateQueries({ queryKey: ["rate-entries"] });
                  queryClient.invalidateQueries({ queryKey: ["resource-effective-rate"] });
                })
                .catch(reportError)
            }
          />
        )}
      </div>

      {editingResource && (
        <ResourceFormModal
          key={editingResource.resource?.resource_id ?? `new-${editingResource.cocId ?? "any"}`}
          resource={editingResource.resource}
          cocOptions={classes}
          organizations={organizations}
          presetCocId={editingResource.cocId}
          isSaving={saveResourceMutation.isPending}
          onClose={() => setEditingResource(null)}
          onCreate={(input) => saveResourceMutation.mutate({ mode: "create", input })}
          onUpdate={(fields) =>
            editingResource.resource &&
            saveResourceMutation.mutate({
              mode: "update",
              resourceId: editingResource.resource.resource_id,
              fields,
            })
          }
        />
      )}

      <Modal
        open={categoryForm !== null}
        onClose={() => setCategoryForm(null)}
        title={categoryForm?.kind === "eoc" ? "New element of cost" : "New class of cost"}
      >
        <div className="flex flex-col gap-4">
          <TextInput
            label="Code"
            required
            value={categoryForm?.code ?? ""}
            onChange={(e) => setCategoryForm((f) => (f ? { ...f, code: e.target.value } : f))}
            helperText="Short identifier — LAB, DL, ODC."
          />
          <TextInput
            label="Name"
            required
            value={categoryForm?.name ?? ""}
            onChange={(e) => setCategoryForm((f) => (f ? { ...f, name: e.target.value } : f))}
          />
          <div className="flex gap-2">
            <button
              onClick={() => categoryForm && categoryMutation.mutate(categoryForm)}
              disabled={isSaving || !categoryForm?.code.trim() || !categoryForm?.name.trim()}
              className="rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {categoryMutation.isPending ? "Creating..." : "Create"}
            </button>
            <button
              onClick={() => setCategoryForm(null)}
              className="rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={pendingDelete !== null} onClose={() => setPendingDelete(null)} title="Delete this resource?">
        <p className="text-sm text-neutral-700">
          {pendingDelete?.name} will be hidden from the roster. This is a soft delete: the record and its
          history stay in the database, and — worth knowing — any existing assignment of this resource to
          scheduled work still references it. Deleting here does not undo those assignments.
        </p>
        <p className="mt-2 text-sm text-neutral-500">
          To take a resource out of use while leaving assignments intact, setting its status to Inactive is
          usually the better choice.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => pendingDelete && deleteResourceMutation.mutate(pendingDelete.resource_id)}
            disabled={deleteResourceMutation.isPending}
            className="rounded bg-status-error px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {deleteResourceMutation.isPending ? "Deleting..." : "Delete resource"}
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
