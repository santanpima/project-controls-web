import { apiRequest } from "./client";

// Theme 11, Epic 11.4 — Budget Management. The Planned Value side of EVM:
// what the work is estimated to cost, period by period, and the formal
// Performance Measurement Baseline that freezes it.
//
// Three things about this module are worth knowing before using it, because
// each of them is a design decision in the backend rather than an accident of
// this client:
//
// 1. **There is no budget table.** A budget figure is never stored and never
//    directly editable. It is derived, live, by summing base_value x rate over
//    the estimates attached to WBS elements. Editing "the budget" means
//    editing estimates; nothing else writes a budget number anywhere.
//
// 2. **An estimate is not tied to a resource**, despite the backing table
//    being called package_resource_estimate. It carries a quantity, a unit, a
//    rate, a free-text note about where the rate came from, and a fiscal
//    period. Which person or material it represents is described in that note
//    or not at all. Section 26's future-changes note in the status document
//    records this as an open question rather than settled design.
//
// 3. **Every estimate change goes through one endpoint**, submitEstimateChange
//    below, whether or not a baseline exists. Before an approved baseline it
//    applies immediately; after one it becomes a change request needing
//    someone else's approval. Calling a separate "edit" path would bypass the
//    gate, so this client deliberately offers no such path.

// --- Estimates ---------------------------------------------------------------

export type BaseUnit = "hours" | "units";

export const BASE_UNITS: { value: BaseUnit; label: string; hint: string }[] = [
  { value: "hours", label: "Hours", hint: "Labor effort — the rate is a rate per hour." },
  { value: "units", label: "Units", hint: "A count of things — the rate is a price per unit." },
];

// The planning classifications from EIA-748. They are not a separate table:
// each is a classification set directly on a WBS element, with the hierarchy
// coming from the WBS tree itself.
export type PlanningElementType =
  | "control_account"
  | "work_package"
  | "planning_package"
  | "summary_level_planning_package";

export const PLANNING_ELEMENT_TYPES: { value: PlanningElementType; label: string; hint: string }[] = [
  {
    value: "control_account",
    label: "Control account",
    hint: "The management level where cost and schedule meet a responsible organization. Budget rolls up to here.",
  },
  {
    value: "work_package",
    label: "Work package",
    hint: "Detailed, near-term work with its own estimates. The usual home for an estimate.",
  },
  {
    value: "planning_package",
    label: "Planning package",
    hint: "Far-term work inside a control account, estimated but not yet broken into work packages.",
  },
  {
    value: "summary_level_planning_package",
    label: "Summary level planning package",
    hint: "Far-term scope held above the control account level, before it can be distributed.",
  },
];

export interface Estimate {
  estimate_id: number;
  wbs_id: string;
  base_value: string | number;
  base_unit: BaseUnit;
  // Nullable, and the reason several figures on the Cost screen read "no rate"
  // rather than zero: an estimate with no rate contributes nothing to any
  // budget total, because every rollup multiplies by COALESCE(rate, 0).
  rate: string | number | null;
  rate_source: string | null;
  fiscal_period_id: string | null;
  // Joined context, so a screen showing many estimates doesn't need a lookup
  // per row.
  wbs_code: string;
  wbs_name: string;
  planning_element_type: PlanningElementType | null;
  period_number: number | null;
  period_start_date: string | null;
  period_end_date: string | null;
}

export function listEstimates(projectId: string): Promise<Estimate[]> {
  return apiRequest<Estimate[]>("/budget/estimates", { query: { projectId } });
}

// --- Estimate changes (11.4.1.1.3) -------------------------------------------

export interface AddEstimateChange {
  action: "add";
  wbsId: string;
  baseValue: number;
  baseUnit?: BaseUnit;
  rate?: number | null;
  rateSource?: string | null;
  fiscalPeriodId?: string | null;
}

export interface UpdateEstimateChange {
  action: "update";
  estimateId: number;
  baseValue: number;
  rate: number | null;
}

export interface RemoveEstimateChange {
  action: "remove";
  estimateId: number;
}

export type EstimateChange = AddEstimateChange | UpdateEstimateChange | RemoveEstimateChange;

export interface BudgetChangeRequest {
  budget_change_request_id: number;
  budget_baseline_id: number;
  requested_by: string | null;
  requested_at: string;
  proposed_change: { description?: string } & Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  approved_by: string | null;
  approved_at: string | null;
}

// The same union the WBS module uses for its own gated edits: a 202 carrying a
// change request is a genuinely different outcome from a successful edit, not
// an error, so it is modeled as an alternative rather than flattened into an
// optimistic "it saved".
export interface GatedEstimateChange {
  status: "pending_approval";
  changeRequest: BudgetChangeRequest;
}

export type MaybeGatedEstimate = Estimate | GatedEstimateChange | null;

export function isGatedEstimate(result: MaybeGatedEstimate): result is GatedEstimateChange {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as GatedEstimateChange).status === "pending_approval"
  );
}

export function submitEstimateChange(input: {
  projectId: string;
  change: EstimateChange;
  description?: string;
  requestedBy?: string;
}): Promise<MaybeGatedEstimate> {
  return apiRequest<MaybeGatedEstimate>("/budget/estimate-changes", { method: "POST", body: input });
}

// --- Rollups -----------------------------------------------------------------

export interface BudgetPeriodRow {
  control_account_wbs_id: string;
  fiscal_period_id: string;
  budgeted_amount: string | number;
}

// 11.4.1.1.1 — the time-phased budget, computed live. Returns nothing at all
// for a project with no WBS element classified as a control account, which is
// a real state rather than an error and one the screen explains rather than
// showing an empty table.
export function listBudgetPeriods(projectId: string): Promise<BudgetPeriodRow[]> {
  return apiRequest<BudgetPeriodRow[]>("/budget/periods", { query: { projectId } });
}

// --- Baselines (11.4.1.1.2) --------------------------------------------------

export interface BudgetBaseline {
  budget_baseline_id: number;
  project_id: string;
  name: string;
  captured_at: string;
  captured_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  snapshot?: BudgetPeriodRow[];
}

export interface BudgetStatus {
  isBaselined: boolean;
  activeBaseline: BudgetBaseline | null;
  totalBaselinesCaptured: number;
}

// Deliberately a status, not a gate. A project never needs a baseline to
// function: planning and actual work both proceed without one. This reports
// whether estimate edits currently apply directly or go through approval.
export function getBudgetStatus(projectId: string): Promise<BudgetStatus> {
  return apiRequest<BudgetStatus>("/budget/status", { query: { projectId } });
}

export function listBaselines(projectId: string): Promise<BudgetBaseline[]> {
  return apiRequest<BudgetBaseline[]>("/budget/baselines", { query: { projectId } });
}

export function captureBaseline(input: {
  projectId: string;
  name: string;
  capturedBy?: string;
}): Promise<BudgetBaseline> {
  return apiRequest<BudgetBaseline>("/budget/baselines", { method: "POST", body: input });
}

export function approveBaseline(baselineId: number, approvedBy?: string): Promise<BudgetBaseline> {
  return apiRequest<BudgetBaseline>(`/budget/baselines/${baselineId}/approve`, {
    method: "POST",
    body: { approvedBy },
  });
}

export function listChangeRequests(baselineId: number, status?: string): Promise<BudgetChangeRequest[]> {
  return apiRequest<BudgetChangeRequest[]>("/budget/change-requests", {
    query: status ? { baselineId: String(baselineId), status } : { baselineId: String(baselineId) },
  });
}

// The backend refuses a decision from the person who requested the change —
// the same non-self-approval rule the WBS and rate-table workflows use. That
// refusal arrives as a 400 and is shown to the user as what it is.
export function resolveChangeRequest(
  changeRequestId: number,
  decision: "approved" | "rejected",
  resolvedBy?: string
): Promise<BudgetChangeRequest> {
  return apiRequest<BudgetChangeRequest>(`/budget/change-requests/${changeRequestId}/resolve`, {
    method: "POST",
    body: { decision, resolvedBy },
  });
}

// --- Planning classification (12.1.1.2.2) ------------------------------------

// Lives under the scheduling module rather than budget or WBS, which is why
// this call needs the "scheduling" permission while everything else in this
// file needs "cost". The Cost screen checks both rather than assuming one
// answer covers the page.
export function setPlanningElementType(
  wbsId: string,
  planningElementType: PlanningElementType
): Promise<unknown> {
  return apiRequest(`/scheduling/wbs/${wbsId}/planning-element-type`, {
    method: "PUT",
    body: { planningElementType },
  });
}
