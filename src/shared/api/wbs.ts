import { apiRequest } from "./client";

// Typed client for Theme 7 (WBS). Mirrors the backend's own wbs routes
// exactly — including one real inconsistency in that API worth naming here
// rather than quietly absorbing at every call site: creating an element
// takes camelCase input (the service layer reads input.isReportingElement,
// input.acceptanceCriteria), while updating one takes the raw snake_case
// column names (the repository filters the body against its own allow-list
// of column names). Both shapes are honored below, and normalized here, so
// no screen has to remember which side of that line it's on.

export type WbsStatus = "planned" | "active" | "complete";

export type WbsCategory =
  | "hardware"
  | "software"
  | "systems_engineering"
  | "integration_and_test"
  | "program_management";

// The five categories the wbs_category enum actually allows (V3 migration),
// with display labels — an enum column can only ever hold one of these, so
// the list is safe to hold on the client rather than fetched.
export const WBS_CATEGORIES: { value: WbsCategory; label: string }[] = [
  { value: "hardware", label: "Hardware" },
  { value: "software", label: "Software" },
  { value: "systems_engineering", label: "Systems Engineering" },
  { value: "integration_and_test", label: "Integration & Test" },
  { value: "program_management", label: "Program Management" },
];

export const WBS_STATUSES: { value: WbsStatus; label: string }[] = [
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "complete", label: "Complete" },
];

export interface WbsElement {
  wbs_id: string;
  project_id: string;
  parent_wbs_id: string | null;
  code: string;
  name: string;
  level: number;
  category: WbsCategory | null;
  is_reporting_element: boolean;
  status: WbsStatus;
  // 12.1.1.2.2 — the EIA-748 planning classification. Null for most elements:
  // it is set through the scheduling module's own endpoint, not through this
  // one, and the Cost screen is where it is actually used. Included here
  // because the tree endpoint already returns it and every consumer would
  // otherwise re-declare it.
  planning_element_type:
    | "control_account"
    | "work_package"
    | "planning_package"
    | "summary_level_planning_package"
    | null;
  // The five dictionary fields (7.1.1.1.3 + 7.1.2.1.1). All nullable at the
  // database level — a summary node legitimately has no dictionary entry.
  description: string | null;
  scope: string | null;
  deliverable: string | null;
  exclusions: string | null;
  acceptance_criteria: string | null;
  created_at: string;
  updated_at: string;
}

export interface WbsChangeRequest {
  change_request_id: number;
  baseline_id: number;
  requested_by: string | null;
  requested_at: string;
  description: string;
  status: "pending" | "approved" | "rejected";
}

// 7.1.2.2.3 — once a project has an approved baseline, an edit doesn't
// apply directly: the backend returns 202 with a change request that still
// needs someone else's approval. That's a genuinely different outcome from
// a successful edit, not an error, so it's modeled as a union rather than
// flattened into one optimistic "it saved" path.
export interface GatedChange {
  status: "pending_approval";
  changeRequest: WbsChangeRequest;
}

export type MaybeGated<T> = T | GatedChange;

export function isGated<T extends object>(result: MaybeGated<T>): result is GatedChange {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as GatedChange).status === "pending_approval"
  );
}

export interface ControlAccountStatus {
  linked: boolean;
  controlAccountId?: string;
  obsId?: string;
  budget?: string | number | null;
}

// Editable fields, in the snake_case shape the update endpoint's own
// column allow-list expects.
export interface WbsEditableFields {
  name?: string;
  category?: WbsCategory | null;
  is_reporting_element?: boolean;
  description?: string | null;
  scope?: string | null;
  deliverable?: string | null;
  exclusions?: string | null;
  acceptance_criteria?: string | null;
}

export interface CreateWbsElementInput {
  projectId: string;
  parentWbsId: string | null;
  name: string;
  category?: WbsCategory | null;
  isReportingElement?: boolean;
  description?: string | null;
  scope?: string | null;
  deliverable?: string | null;
  exclusions?: string | null;
  acceptanceCriteria?: string | null;
}

// 7.1.1.2.1 — the whole project tree in one request, already ordered so a
// parent always precedes its own children (the backend's recursive CTE
// sorts by materialized code path). The tree shape itself is rebuilt on
// the client from parent_wbs_id; see wbs-tree.ts.
export function listWbsElements(projectId: string): Promise<WbsElement[]> {
  return apiRequest<WbsElement[]>("/wbs", { query: { projectId } });
}

export function getWbsElement(wbsId: string): Promise<WbsElement> {
  return apiRequest<WbsElement>(`/wbs/${wbsId}`);
}

// 7.1.2.1.3 — control-account linkage indicator.
export function getControlAccountStatus(wbsId: string): Promise<ControlAccountStatus> {
  return apiRequest<ControlAccountStatus>(`/wbs/${wbsId}/control-account-status`);
}

export function createWbsElement(
  input: CreateWbsElementInput,
  changeDescription?: string
): Promise<MaybeGated<WbsElement>> {
  return apiRequest<MaybeGated<WbsElement>>("/wbs", {
    method: "POST",
    body: { ...input, changeDescription },
  });
}

export function updateWbsElement(
  wbsId: string,
  fields: WbsEditableFields,
  changeDescription?: string
): Promise<MaybeGated<WbsElement>> {
  return apiRequest<MaybeGated<WbsElement>>(`/wbs/${wbsId}`, {
    method: "PUT",
    body: { ...fields, changeDescription },
  });
}

// 7.1.1.1.2 — reparent. The moved element and its whole subtree are
// renumbered server-side; the client just refetches the tree afterward
// rather than trying to predict the new codes itself.
export function moveWbsElement(
  wbsId: string,
  newParentWbsId: string | null,
  changeDescription?: string
): Promise<MaybeGated<WbsElement>> {
  return apiRequest<MaybeGated<WbsElement>>(`/wbs/${wbsId}/move`, {
    method: "POST",
    body: { newParentWbsId, changeDescription },
  });
}

// 7.1.2.1.3 — status lifecycle. Completing a parent whose children aren't
// complete is a warning, never a block: the update goes through and the
// warning comes back alongside it, which is exactly why this returns both.
export interface StatusChangeResult {
  element: WbsElement;
  warning: string | null;
}

export function setWbsStatus(wbsId: string, status: WbsStatus): Promise<StatusChangeResult> {
  return apiRequest<StatusChangeResult>(`/wbs/${wbsId}/status`, {
    method: "POST",
    body: { status },
  });
}

// Soft delete. Refused with a 409 by the backend if the element still has
// children — surfaced to the person as that message rather than swallowed.
export function deleteWbsElement(wbsId: string): Promise<void> {
  return apiRequest<void>(`/wbs/${wbsId}`, { method: "DELETE" });
}
