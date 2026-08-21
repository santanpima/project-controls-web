import { useState } from "react";
import { Modal } from "@shared/components/Modal";
import { TextInput } from "@shared/components/TextInput";
import { TextArea } from "@shared/components/TextArea";
import { Select } from "@shared/components/Select";
import * as resourcesApi from "@shared/api/resources";
import type { ClearanceLevel, Resource, ResourceStatus, ResourceType } from "@shared/api/resources";
import type { OrgElement } from "@shared/api/obs";
import type { CocOption } from "./resource-tree";

// 10.2.1.2.1 / 10.2.3.1.2 — the resource creation and edit form.
//
// The fields shown depend on the resource type, because the specification
// models three genuinely different things rather than one thing with optional
// columns: labor carries a category, skill, clearance and rate; material
// carries a supplier and part number; other carries a description. Showing all
// of them at once would invite a part number on a person.

interface ResourceFormModalProps {
  resource: Resource | null; // null = creating
  cocOptions: CocOption[];
  organizations: OrgElement[];
  presetCocId?: number;
  isSaving: boolean;
  onClose: () => void;
  onCreate: (input: Omit<resourcesApi.CreateResourceInput, "projectId">) => void;
  onUpdate: (fields: resourcesApi.ResourceEditableFields) => void;
}

export function ResourceFormModal({
  resource, cocOptions, organizations, presetCocId, isSaving, onClose, onCreate, onUpdate,
}: ResourceFormModalProps): JSX.Element {
  const [name, setName] = useState(resource?.name ?? "");
  const [code, setCode] = useState(resource?.code ?? "");
  const [resourceType, setResourceType] = useState<ResourceType>(resource?.resource_type ?? "labor");
  const [cocId, setCocId] = useState(String(resource?.coc_id ?? presetCocId ?? ""));
  const [obsId, setObsId] = useState(resource?.obs_id ?? "");
  const [status, setStatus] = useState<ResourceStatus>(resource?.status ?? "active");
  const [unitOfMeasure, setUnitOfMeasure] = useState(resource?.unit_of_measure ?? "");
  const [rate, setRate] = useState(resource?.rate ?? "");
  const [laborCategory, setLaborCategory] = useState(resource?.labor_category ?? "");
  const [skill, setSkill] = useState(resource?.skill ?? "");
  const [clearance, setClearance] = useState<ClearanceLevel>(resource?.clearance_level ?? "none");
  const [supplier, setSupplier] = useState(resource?.supplier ?? "");
  const [partNumber, setPartNumber] = useState(resource?.part_number ?? "");
  const [description, setDescription] = useState(resource?.description ?? "");

  const canSubmit = name.trim() !== "" && cocId !== "" && obsId !== "";

  function submit() {
    // Fields belonging to the other two types are sent as null rather than
    // left untouched, so changing a person into a material doesn't leave a
    // stale clearance level behind on the row.
    const isLabor = resourceType === "labor";
    const isMaterial = resourceType === "material";

    if (resource) {
      onUpdate({
        name: name.trim(),
        code: code.trim() || null,
        resource_type: resourceType,
        coc_id: Number(cocId),
        obs_id: obsId,
        status,
        unit_of_measure: unitOfMeasure.trim() || null,
        rate: isLabor && String(rate).trim() !== "" ? Number(rate) : null,
        labor_category: isLabor ? laborCategory.trim() || null : null,
        skill: isLabor ? skill.trim() || null : null,
        clearance_level: isLabor ? clearance : "none",
        supplier: isMaterial ? supplier.trim() || null : null,
        part_number: isMaterial ? partNumber.trim() || null : null,
        description: description.trim() || null,
      });
      return;
    }

    onCreate({
      name: name.trim(),
      code: code.trim() || null,
      resourceType,
      cocId: Number(cocId),
      obsId,
      status,
      unitOfMeasure: unitOfMeasure.trim() || null,
      rate: isLabor && String(rate).trim() !== "" ? Number(rate) : null,
      laborCategory: isLabor ? laborCategory.trim() || null : null,
      skill: isLabor ? skill.trim() || null : null,
      clearanceLevel: isLabor ? clearance : "none",
      supplier: isMaterial ? supplier.trim() || null : null,
      partNumber: isMaterial ? partNumber.trim() || null : null,
      description: description.trim() || null,
    });
  }

  return (
    <Modal open onClose={onClose} title={resource ? `Edit ${resource.name}` : "New resource"}>
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
        <TextInput label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <TextInput
          label="Code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          helperText="Optional short identifier — ENG-1, AL-6061."
        />

        <Select
          label="Type"
          options={resourcesApi.RESOURCE_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          value={resourceType}
          onChange={(e) => setResourceType(e.target.value as ResourceType)}
          helperText={resourcesApi.RESOURCE_TYPES.find((t) => t.value === resourceType)?.hint}
        />

        <Select
          label="Cost classification"
          required
          placeholder="— choose a class of cost —"
          options={cocOptions.map((o) => ({ value: String(o.coc_id), label: o.label }))}
          value={cocId}
          onChange={(e) => setCocId(e.target.value)}
          helperText="Where this resource's cost lands in the EOC/COC hierarchy."
        />

        <Select
          label="Owning organization"
          required
          placeholder="— choose an organization —"
          options={organizations.map((o) => ({ value: o.org_id, label: `${o.org_code}  ${o.name}` }))}
          value={obsId}
          onChange={(e) => setObsId(e.target.value)}
          helperText="Its home organization in the OBS — which also decides the calendar it inherits."
        />

        <TextInput
          label="Unit of measure"
          value={unitOfMeasure}
          onChange={(e) => setUnitOfMeasure(e.target.value)}
          helperText="Leave blank to inherit from the cost class, then the element of cost above it."
        />

        {resourceType === "labor" && (
          <>
            <TextInput
              label="Labor category"
              value={laborCategory}
              onChange={(e) => setLaborCategory(e.target.value)}
              helperText="Links this person to the rate table, where rates can change over time."
            />
            <TextInput label="Skill" value={skill} onChange={(e) => setSkill(e.target.value)} />
            <Select
              label="Security clearance"
              options={resourcesApi.CLEARANCE_LEVELS.map((c) => ({ value: c.value, label: c.label }))}
              value={clearance}
              onChange={(e) => setClearance(e.target.value as ClearanceLevel)}
            />
            <TextInput
              label="Fixed rate"
              type="number"
              step="0.01"
              value={String(rate)}
              onChange={(e) => setRate(e.target.value)}
              helperText="A flat rate for this person. Leave blank to use the labor category's rate table instead, which escalates over time."
            />
          </>
        )}

        {resourceType === "material" && (
          <>
            <TextInput label="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            <TextInput label="Part number" value={partNumber} onChange={(e) => setPartNumber(e.target.value)} />
          </>
        )}

        <TextArea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />

        <Select
          label="Status"
          options={resourcesApi.RESOURCE_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
          value={status}
          onChange={(e) => setStatus(e.target.value as ResourceStatus)}
          helperText="Inactive keeps the record and its history without offering it for new assignments."
        />

        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={isSaving || !canSubmit}
            className="rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSaving ? "Saving..." : resource ? "Save changes" : "Create resource"}
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
