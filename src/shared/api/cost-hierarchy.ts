import { apiRequest } from "./client";

// Theme 10, Epic 10.1 — the two-level cost classification every resource hangs
// off: Element of Cost (Labor / Material / Other) with Classes of Cost beneath
// (Direct Labor, Overtime, Raw Material, Subcontract, Travel, ODC).
//
// One deviation from the specification is already built into this API and
// worth remembering while using it: the roadmap calls for the standard seeded
// categories to be permanently protected from renaming or deletion. That
// protection was deliberately removed at the customer's request, so migrations
// from legacy systems can use their own naming. `is_standard` survives as
// information about which rows were seeded — not as a lock.

export interface Eoc {
  eoc_id: number;
  project_id: string;
  code: string;
  name: string;
  is_standard: boolean;
  sort_order: number;
  unit_of_measure: string | null;
  currency: string | null;
}

export interface Coc {
  coc_id: number;
  eoc_id: number;
  code: string;
  name: string;
  is_standard: boolean;
  sort_order: number;
  unit_of_measure: string | null;
  currency: string | null;
}

export function listEoc(projectId: string): Promise<Eoc[]> {
  return apiRequest<Eoc[]>("/cost-hierarchy/eoc", { query: { projectId } });
}

export function createEoc(input: {
  projectId: string;
  code: string;
  name: string;
  unitOfMeasure?: string | null;
  currency?: string | null;
}): Promise<Eoc> {
  return apiRequest<Eoc>("/cost-hierarchy/eoc", { method: "POST", body: input });
}

export function updateEoc(eocId: number, fields: Partial<Pick<Eoc, "code" | "name" | "unit_of_measure" | "currency" | "sort_order">>): Promise<Eoc> {
  return apiRequest<Eoc>(`/cost-hierarchy/eoc/${eocId}`, { method: "PUT", body: fields });
}

// Refused while anything still hangs off it — a class of cost beneath it, or a
// resource classified under one. That's the ordinary safety net, not the
// removed standard-category protection.
export function deleteEoc(eocId: number): Promise<void> {
  return apiRequest<void>(`/cost-hierarchy/eoc/${eocId}`, { method: "DELETE" });
}

export function listCoc(eocId: number): Promise<Coc[]> {
  return apiRequest<Coc[]>("/cost-hierarchy/coc", { query: { eocId } });
}

export function createCoc(input: {
  eocId: number;
  code: string;
  name: string;
  unitOfMeasure?: string | null;
  currency?: string | null;
}): Promise<Coc> {
  return apiRequest<Coc>("/cost-hierarchy/coc", { method: "POST", body: input });
}

export function updateCoc(cocId: number, fields: Partial<Pick<Coc, "code" | "name" | "unit_of_measure" | "currency" | "sort_order">>): Promise<Coc> {
  return apiRequest<Coc>(`/cost-hierarchy/coc/${cocId}`, { method: "PUT", body: fields });
}

export function deleteCoc(cocId: number): Promise<void> {
  return apiRequest<void>(`/cost-hierarchy/coc/${cocId}`, { method: "DELETE" });
}

// 10.1.1.1.1 / 10.1.2.1.2 — seeds the standard three-tier structure. Idempotent,
// and normally already done at project creation; offered on screen for a
// project that predates that behaviour or had its hierarchy emptied.
export function seedStandardHierarchy(projectId: string): Promise<unknown> {
  return apiRequest("/cost-hierarchy/seed", { method: "POST", body: { projectId } });
}
