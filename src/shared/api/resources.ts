import { apiRequest } from "./client";
import type { ResourceTreeRow } from "@features/resources/resource-tree";

// Theme 10 — the roster of people, equipment and materials a project draws on,
// classified beneath the EOC/COC cost hierarchy and owned by an organization.
//
// Worth knowing before reading further: this screen spans two permission
// modules. Resources are governed by "resource"; the EOC/COC hierarchy they
// hang off is governed by "cost" (see the router mounting in app.js). A role
// can hold one without the other, so the screen checks both rather than
// assuming a single answer.

export type ResourceType = "labor" | "material" | "other";
export type ResourceStatus = "active" | "inactive";
export type ClearanceLevel = "none" | "public_trust" | "confidential" | "secret" | "top_secret";

export const RESOURCE_TYPES: { value: ResourceType; label: string; hint: string }[] = [
  { value: "labor", label: "Labor", hint: "A person or role, carrying a rate, skill and clearance." },
  { value: "material", label: "Material", hint: "A purchased item, carrying a supplier and part number." },
  { value: "other", label: "Other", hint: "Anything else — travel, equipment, facilities." },
];

export const RESOURCE_STATUSES: { value: ResourceStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

// 10.2.2.2.3 — the five clearance levels, lowest first.
export const CLEARANCE_LEVELS: { value: ClearanceLevel; label: string }[] = [
  { value: "none", label: "None" },
  { value: "public_trust", label: "Public Trust" },
  { value: "confidential", label: "Confidential" },
  { value: "secret", label: "Secret" },
  { value: "top_secret", label: "Top Secret" },
];

export interface Resource {
  resource_id: string;
  project_id: string;
  obs_id: string;
  calendar_id: string | null;
  coc_id: number;
  category_id: number | null;
  name: string;
  code: string | null;
  resource_type: ResourceType;
  unit_of_measure: string | null;
  rate: string | null;
  rate_table_entry_id: number | null;
  status: ResourceStatus;
  labor_category: string | null;
  skill: string | null;
  clearance_level: ClearanceLevel;
  supplier: string | null;
  part_number: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateResourceInput {
  projectId: string;
  obsId: string;
  cocId: number;
  name: string;
  resourceType: ResourceType;
  code?: string | null;
  unitOfMeasure?: string | null;
  rate?: number | null;
  rateTableEntryId?: number | null;
  status?: ResourceStatus;
  laborCategory?: string | null;
  skill?: string | null;
  clearanceLevel?: ClearanceLevel;
  supplier?: string | null;
  partNumber?: string | null;
  description?: string | null;
}

// snake_case, matching the update endpoint's own column allow-list.
export interface ResourceEditableFields {
  obs_id?: string;
  coc_id?: number;
  name?: string;
  code?: string | null;
  resource_type?: ResourceType;
  unit_of_measure?: string | null;
  rate?: number | null;
  status?: ResourceStatus;
  labor_category?: string | null;
  skill?: string | null;
  clearance_level?: ClearanceLevel;
  supplier?: string | null;
  part_number?: string | null;
  description?: string | null;
}

// 10.2.1.1.3 — the EOC > COC > Resource tree, returned as a denormalised join.
// See resource-tree.ts for the folding, which is where the null-branch cases
// are handled.
export function getResourceTree(projectId: string): Promise<ResourceTreeRow[]> {
  return apiRequest<ResourceTreeRow[]>("/resources/tree", { query: { projectId } });
}

export function listResources(projectId: string): Promise<Resource[]> {
  return apiRequest<Resource[]>("/resources", { query: { projectId } });
}

export function getResource(resourceId: string): Promise<Resource> {
  return apiRequest<Resource>(`/resources/${resourceId}`);
}

export function createResource(input: CreateResourceInput): Promise<Resource> {
  return apiRequest<Resource>("/resources", { method: "POST", body: input });
}

export function updateResource(resourceId: string, fields: ResourceEditableFields): Promise<Resource> {
  return apiRequest<Resource>(`/resources/${resourceId}`, { method: "PUT", body: fields });
}

export function deleteResource(resourceId: string): Promise<void> {
  return apiRequest<void>(`/resources/${resourceId}`, { method: "DELETE" });
}

// 10.1.1.2.3 — the "null means inherit" chain: a resource's own unit of
// measure, else its cost class's, else its element of cost's. Resolved
// server-side so the screen shows the same answer every calculation uses.
export interface EffectiveUnitOfMeasure {
  unitOfMeasure: string | null;
  source?: string;
}

export function getEffectiveUnitOfMeasure(resourceId: string): Promise<EffectiveUnitOfMeasure> {
  return apiRequest<EffectiveUnitOfMeasure>(`/resources/${resourceId}/effective-unit-of-measure`);
}

// 10.2.2.2.2 — a labor resource can carry a fixed rate, or point at a rate
// table entry that changes over time. This resolves whichever applies on a
// given date, which is the number any cost calculation would actually use.
export interface EffectiveRate {
  rate: string | number | null;
  source?: string;
  asOf?: string;
}

export function getEffectiveRate(resourceId: string, asOf?: string): Promise<EffectiveRate> {
  return apiRequest<EffectiveRate>(`/resources/${resourceId}/effective-rate`, {
    query: asOf ? { asOf } : undefined,
  });
}

export interface RateTableEntry {
  entry_id: number;
  project_id: string;
  labor_category: string;
  rate: string;
  effective_start_date: string;
  effective_end_date: string | null;
  currency: string | null;
  unit_of_measure: string | null;
  escalation_pct: string | null;
}

export function listRateEntries(projectId: string, laborCategory: string): Promise<RateTableEntry[]> {
  return apiRequest<RateTableEntry[]>("/resources/rate-table", {
    query: { projectId, laborCategory },
  });
}

export function createRateEntry(input: {
  projectId: string;
  laborCategory: string;
  rate: number;
  startDate: string;
  endDate?: string | null;
}): Promise<RateTableEntry> {
  return apiRequest<RateTableEntry>("/resources/rate-table", { method: "POST", body: input });
}

// 10.2.1.2.3 — change history, the same shared audit trail every other module
// writes to.
export interface ResourceHistoryEntry {
  audit_id: number;
  action: string;
  changed_at: string;
  changed_by: string | null;
  field_name?: string | null;
  old_value?: string | null;
  new_value?: string | null;
}

export function getResourceHistory(resourceId: string): Promise<ResourceHistoryEntry[]> {
  return apiRequest<ResourceHistoryEntry[]>(`/resources/${resourceId}/history`);
}
