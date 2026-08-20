import { apiRequest, apiRequestText } from "./client";

// Typed client for Theme 8 (OBS). Deliberately simpler than the WBS client:
// an organization carries no dictionary, no baseline and no change-request
// gating, so an edit here applies immediately. That asymmetry is the
// specification's own (8.1's note that OBS is a supporting structure, not
// something project performance is measured against), not a gap.

export type OrgType = "internal" | "subcontractor" | "vendor" | "government_customer";

// The four standard types (8.1.2.1.1), which are an enum column in the
// database — the list can safely live on the client.
export const ORG_TYPES: { value: OrgType; label: string }[] = [
  { value: "internal", label: "Internal" },
  { value: "subcontractor", label: "Subcontractor" },
  { value: "vendor", label: "Vendor" },
  { value: "government_customer", label: "Government / Customer" },
];

export interface OrgElement {
  org_id: string;
  project_id: string;
  parent_obs_id: string | null;
  org_code: string;
  name: string;
  type: OrgType | null;
  level: number;
  calendar_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateOrgInput {
  projectId: string;
  parentObsId: string | null;
  orgCode: string;
  name: string;
  type?: OrgType | null;
}

// Editable fields, in the snake_case shape the update endpoint's own column
// allow-list expects — the same split as WBS, where create takes camelCase
// and update takes column names.
export interface OrgEditableFields {
  org_code?: string;
  name?: string;
  type?: OrgType | null;
}

// 8.1.1.1.3 — the whole project org chart in one request.
export function listOrgs(projectId: string): Promise<OrgElement[]> {
  return apiRequest<OrgElement[]>("/obs", { query: { projectId } });
}

export function getOrg(orgId: string): Promise<OrgElement> {
  return apiRequest<OrgElement>(`/obs/${orgId}`);
}

export function createOrg(input: CreateOrgInput): Promise<OrgElement> {
  return apiRequest<OrgElement>("/obs", { method: "POST", body: input });
}

export function updateOrg(orgId: string, fields: OrgEditableFields): Promise<OrgElement> {
  return apiRequest<OrgElement>(`/obs/${orgId}`, { method: "PUT", body: fields });
}

// 8.1.1.1.2 — reparent. Unlike WBS there is no drag-and-drop equivalent by
// design (8.1.1.1.3's own note): this endpoint is the reorganization
// mechanism, sitting behind the parent field on the edit form.
export function moveOrg(orgId: string, newParentObsId: string | null): Promise<OrgElement> {
  return apiRequest<OrgElement>(`/obs/${orgId}/move`, { method: "POST", body: { newParentObsId } });
}

export function deleteOrg(orgId: string): Promise<void> {
  return apiRequest<void>(`/obs/${orgId}`, { method: "DELETE" });
}

// 8.1.1.2.2 — bulk import. The backend validates the entire file before
// writing anything: on failure it returns 400 with a list of per-line
// messages and the database is left completely untouched. That list is the
// most useful thing this screen can show, so it's modeled explicitly here
// rather than flattened into a single error string.
export interface ImportFailure {
  error: string;
  details: string[];
}

export interface ImportResult {
  created: OrgElement[];
  failure: ImportFailure | null;
}

export async function importOrgsCsv(projectId: string, csv: string): Promise<ImportResult> {
  try {
    const created = await apiRequest<OrgElement[]>("/obs/import", {
      method: "POST",
      body: { projectId, csv },
    });
    return { created, failure: null };
  } catch (error) {
    const body = (error as { body?: unknown }).body;
    if (body && typeof body === "object" && Array.isArray((body as ImportFailure).details)) {
      return { created: [], failure: body as ImportFailure };
    }
    throw error;
  }
}

// 8.1.1.2.2 — bulk export. Answers with text/csv, not JSON.
export function exportOrgsCsv(projectId: string): Promise<string> {
  return apiRequestText("/obs/export", { query: { projectId } });
}
