import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Pencil, Trash2, Plus, HardHat, Package, Boxes } from "lucide-react";
import { TextInput } from "@shared/components/TextInput";
import { Tabs } from "@shared/components/Tabs";
import * as resourcesApi from "@shared/api/resources";
import type { Resource } from "@shared/api/resources";
import type { OrgElement } from "@shared/api/obs";

// The detail view for one resource: its own attributes, the two values it
// *inherits* rather than stores, its rate history, and its audit trail.
//
// The inherited values are the reason this panel exists rather than a wider
// table. A resource's unit of measure and effective rate are both resolved
// server-side through chains the row itself doesn't show — unit of measure
// falls back through the cost class to the element of cost, and a labor rate
// may come from a rate table that changes by date rather than the row's own
// column. Displaying the stored column alone would show something other than
// the number a cost calculation would actually use.

interface ResourceDetailPanelProps {
  resource: Resource;
  organizations: OrgElement[];
  canUpdate: boolean;
  canDelete: boolean;
  isSaving: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddRateEntry: (input: { laborCategory: string; rate: number; startDate: string; endDate: string | null }) => void;
}

const TYPE_ICON = { labor: HardHat, material: Package, other: Boxes };

export function ResourceDetailPanel({
  resource, organizations, canUpdate, canDelete, isSaving, onClose, onEdit, onDelete, onAddRateEntry,
}: ResourceDetailPanelProps): JSX.Element {
  const [tab, setTab] = useState("details");
  const [newRate, setNewRate] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");

  const effectiveRateQuery = useQuery({
    queryKey: ["resource-effective-rate", resource.resource_id],
    queryFn: () => resourcesApi.getEffectiveRate(resource.resource_id),
    enabled: resource.resource_type === "labor",
  });
  const effectiveUomQuery = useQuery({
    queryKey: ["resource-effective-uom", resource.resource_id],
    queryFn: () => resourcesApi.getEffectiveUnitOfMeasure(resource.resource_id),
  });
  const rateEntriesQuery = useQuery({
    queryKey: ["rate-entries", resource.project_id, resource.labor_category],
    queryFn: () => resourcesApi.listRateEntries(resource.project_id, resource.labor_category as string),
    enabled: resource.resource_type === "labor" && !!resource.labor_category,
  });
  const historyQuery = useQuery({
    queryKey: ["resource-history", resource.resource_id],
    queryFn: () => resourcesApi.getResourceHistory(resource.resource_id),
    enabled: tab === "history",
  });

  const orgName = organizations.find((o) => o.org_id === resource.obs_id);
  const Icon = TYPE_ICON[resource.resource_type];

  const field = (label: string, value: string | null | undefined, hint?: string) => (
    <div key={label}>
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="text-sm text-neutral-800">
        {value ? value : <span className="text-neutral-400">Not set</span>}
        {hint && <div className="text-xs text-neutral-500">{hint}</div>}
      </dd>
    </div>
  );

  return (
    <aside className="rounded bg-white shadow-elevation-1 xl:w-[420px] xl:shrink-0">
      <div className="flex items-start justify-between gap-2 border-b border-neutral-200 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-neutral-500">
            <Icon size={12} />
            {resourcesApi.RESOURCE_TYPES.find((t) => t.value === resource.resource_type)?.label}
            {resource.status === "inactive" && (
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-500">inactive</span>
            )}
          </div>
          <h2 className="truncate text-lg font-semibold text-neutral-800">{resource.name}</h2>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
          aria-label="Close resource panel"
        >
          <X size={18} />
        </button>
      </div>

      <div className="px-4 pt-2">
        <Tabs
          tabs={[
            { key: "details", label: "Details" },
            { key: "rates", label: "Rates" },
            { key: "history", label: "History" },
          ]}
          activeKey={tab}
          onChange={setTab}
        />
      </div>

      {tab === "details" && (
        <div className="flex flex-col gap-4 px-4 py-4">
          <dl className="flex flex-col gap-3">
            {field("Code", resource.code)}
            {field("Owning organization", orgName ? `${orgName.org_code} ${orgName.name}` : null)}
            {field(
              "Unit of measure",
              effectiveUomQuery.data?.unitOfMeasure ?? resource.unit_of_measure,
              resource.unit_of_measure
                ? undefined
                : effectiveUomQuery.data?.unitOfMeasure
                  ? "Inherited from the cost hierarchy — not set on this resource."
                  : undefined
            )}
            {resource.resource_type === "labor" && (
              <>
                {field("Labor category", resource.labor_category)}
                {field("Skill", resource.skill)}
                {field(
                  "Security clearance",
                  resourcesApi.CLEARANCE_LEVELS.find((c) => c.value === resource.clearance_level)?.label
                )}
              </>
            )}
            {resource.resource_type === "material" && (
              <>
                {field("Supplier", resource.supplier)}
                {field("Part number", resource.part_number)}
              </>
            )}
            {field("Description", resource.description)}
          </dl>

          {(canUpdate || canDelete) && (
            <div className="flex gap-2 border-t border-neutral-200 pt-4">
              {canUpdate && (
                <button
                  onClick={onEdit}
                  className="flex items-center gap-1.5 rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
                >
                  <Pencil size={14} /> Edit
                </button>
              )}
              {canDelete && (
                <button
                  onClick={onDelete}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 rounded border border-status-error/40 px-3 py-2 text-sm text-status-error hover:bg-status-error/5 disabled:opacity-50"
                >
                  <Trash2 size={14} /> Delete
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "rates" && (
        <div className="flex flex-col gap-4 px-4 py-4">
          {resource.resource_type !== "labor" ? (
            <p className="text-sm text-neutral-500">
              Rate tables apply to labor resources. A material or other resource carries its cost through
              quantity and unit price at the point of assignment instead.
            </p>
          ) : (
            <>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  Effective rate today
                </div>
                <div className="text-lg font-semibold text-neutral-800">
                  {effectiveRateQuery.isLoading
                    ? "…"
                    : effectiveRateQuery.data?.rate !== null && effectiveRateQuery.data?.rate !== undefined
                      ? String(effectiveRateQuery.data.rate)
                      : "Not set"}
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  {resource.rate
                    ? "This resource carries a fixed rate of its own."
                    : resource.labor_category
                      ? "Resolved from the labor category's rate table, which can change by date."
                      : "No fixed rate and no labor category, so nothing to resolve."}
                </p>
              </div>

              {resource.labor_category && (
                <div className="border-t border-neutral-200 pt-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Rate table — {resource.labor_category}
                  </div>
                  {rateEntriesQuery.isLoading ? (
                    <div className="text-sm text-neutral-500">Loading…</div>
                  ) : (rateEntriesQuery.data ?? []).length === 0 ? (
                    <p className="mt-1 text-sm text-neutral-400">No entries for this category yet.</p>
                  ) : (
                    <ul className="divide-y divide-neutral-100">
                      {(rateEntriesQuery.data ?? []).map((entry) => (
                        <li key={entry.entry_id} className="flex items-center justify-between py-1.5 text-sm">
                          <span className="text-neutral-800">{entry.rate}</span>
                          <span className="text-xs text-neutral-500">
                            {entry.effective_start_date.slice(0, 10)} →{" "}
                            {entry.effective_end_date ? entry.effective_end_date.slice(0, 10) : "open"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {canUpdate && (
                    <div className="mt-3 flex flex-col gap-2">
                      <TextInput
                        label="New rate"
                        type="number"
                        step="0.01"
                        value={newRate}
                        onChange={(e) => setNewRate(e.target.value)}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <TextInput
                          label="Effective from"
                          type="date"
                          value={newStart}
                          onChange={(e) => setNewStart(e.target.value)}
                        />
                        <TextInput
                          label="Until (optional)"
                          type="date"
                          value={newEnd}
                          onChange={(e) => setNewEnd(e.target.value)}
                        />
                      </div>
                      <button
                        onClick={() => {
                          onAddRateEntry({
                            laborCategory: resource.labor_category as string,
                            rate: Number(newRate),
                            startDate: newStart,
                            endDate: newEnd || null,
                          });
                          setNewRate("");
                          setNewStart("");
                          setNewEnd("");
                        }}
                        disabled={isSaving || newRate === "" || newStart === ""}
                        className="flex w-fit items-center gap-1.5 rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        <Plus size={14} /> Add rate entry
                      </button>
                      <p className="text-xs text-neutral-500">
                        Entries apply to every labor resource in this category, not just this one.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="flex flex-col gap-2 px-4 py-4">
          {historyQuery.isLoading ? (
            <div className="text-sm text-neutral-500">Loading history…</div>
          ) : (historyQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-neutral-400">No changes recorded since this resource was created.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {(historyQuery.data ?? []).map((entry) => (
                <li key={entry.audit_id} className="py-2 text-sm">
                  <div className="text-neutral-800">
                    {entry.action}
                    {entry.field_name ? ` · ${entry.field_name}` : ""}
                  </div>
                  {(entry.old_value || entry.new_value) && (
                    <div className="text-xs text-neutral-500">
                      {entry.old_value ?? "—"} → {entry.new_value ?? "—"}
                    </div>
                  )}
                  <div className="text-xs text-neutral-400">{entry.changed_at?.slice(0, 19).replace("T", " ")}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
