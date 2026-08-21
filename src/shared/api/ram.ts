import { apiRequest } from "./client";

// Theme 8, Epic 8.3 — the Responsibility Assignment Matrix.
//
// A control account is the intersection of a WBS element and an organization:
// the point where scope, budget and a responsible manager meet. The RAM is the
// grid of those intersections — WBS elements down the side, organizations
// across the top, a cell filled where a control account exists.
//
// Two things to know before using this module, both of which shape the screen:
//
// 1. **There is no delete.** No endpoint anywhere removes a control account.
//    A row created by mistake can be reassigned to a different organization or
//    have its budget corrected, but it cannot be taken back. Creation is
//    therefore treated as a deliberate act with a confirmation, not a
//    click-to-toggle cell.
//
// 2. **The grid is a view, not the source of truth.** A control account's
//    organization is a directly editable field on the row itself. Reassigning
//    it moves the filled cell to a different column the next time the grid is
//    drawn; nothing synchronises separately.

export interface RamCell {
  filled: boolean;
  controlAccountId?: number;
  budget?: string | number;
}

export interface RamRow {
  wbsId: string;
  code: string;
  name: string;
  cells: Record<string, RamCell>;
}

export interface RamColumn {
  obsId: string;
  orgCode: string;
  name: string;
}

// A control account whose organization belongs to a different project. The
// matrix structurally cannot show these — its columns are project-scoped — so
// they are reported alongside the grid rather than silently omitted from it.
// Both write paths now refuse to create one, so this only ever carries rows
// that predate that check.
export interface CrossProjectControlAccount {
  control_account_id: number;
  budget: string | number;
  obs_id: string;
  wbs_id: string;
  wbs_code: string;
  wbs_name: string;
  obs_code: string;
  obs_name: string;
  obs_project_id: string;
}

export interface RamGrid {
  columns: RamColumn[];
  rows: RamRow[];
  crossProjectControlAccounts: CrossProjectControlAccount[];
}

export function getRamGrid(projectId: string): Promise<RamGrid> {
  return apiRequest<RamGrid>("/ram/grid", { query: { projectId } });
}

// 8.3.1.1.3 — reporting elements with no responsible organization. A soft flag
// by design: responsible_obs_id is nullable precisely so an element can sit
// unassigned during early planning, so this surfaces the state without
// preventing anything.
//
// Note what this returns, because getting it wrong disabled half the RAM screen
// once already: **only the failures**, not every element with its flags. The
// screen derives the same list from the WBS elements it already holds, so there
// is one answer to the question rather than two that could disagree. This
// remains the server-side implementation of the rule, and is the right thing to
// call from anywhere that does not already have the WBS loaded.
export interface RamValidationRow {
  wbs_id: string;
  code: string;
  name: string;
  is_reporting_element: boolean;
  responsible_obs_id: string | null;
}

export function getRamValidation(projectId: string): Promise<RamValidationRow[]> {
  return apiRequest<RamValidationRow[]>("/ram/validation", { query: { projectId } });
}

// 8.3.1.2.3 — the flat control account list. A different question from the
// grid's: the matrix answers "which intersections are filled", this answers
// "what control accounts actually exist, and who runs them".
export interface ControlAccountRow {
  control_account_id: number;
  budget: string | number;
  wbs_id: string;
  wbs_code: string;
  wbs_name: string;
  status: string;
  obs_id: string;
  obs_name: string;
  cam_name: string | null;
  cam_email: string | null;
}

export function listControlAccounts(projectId: string): Promise<ControlAccountRow[]> {
  return apiRequest<ControlAccountRow[]>("/ram/dashboard", { query: { projectId } });
}

export interface ControlAccount {
  control_account_id: number;
  wbs_id: string;
  obs_id: string;
  budget: string | number;
  created_at: string;
  updated_at: string;
}

// 8.3.1.2.1 — created at an intersection. wbs_id and obs_id come from the cell
// that was clicked rather than being re-entered; the budget is the one figure a
// person actually supplies.
export function createControlAccount(input: {
  wbsId: string;
  obsId: string;
  budget: number;
}): Promise<ControlAccount> {
  return apiRequest<ControlAccount>("/ram/control-accounts", { method: "POST", body: input });
}

export function reassignControlAccount(controlAccountId: number, newObsId: string): Promise<ControlAccount> {
  return apiRequest<ControlAccount>(`/ram/control-accounts/${controlAccountId}/reassign`, {
    method: "POST",
    body: { newObsId },
  });
}

export function updateControlAccountBudget(controlAccountId: number, budget: number): Promise<ControlAccount> {
  return apiRequest<ControlAccount>(`/ram/control-accounts/${controlAccountId}/budget`, {
    method: "PUT",
    body: { budget },
  });
}

// 8.3.1.2.2 — the Control Account Manager. Not a table of its own: a CAM is a
// point-of-contact assignment whose role happens to be Control Account Manager,
// with two rules layered on top — the control account must already exist, and
// only one CAM is allowed per element, enforced by a database trigger rather
// than by hope.
export interface CamAssignment {
  wbs_poc_assignment_id: number;
  wbs_id: string;
  obs_id: string;
  role_id: number;
  contact_name: string | null;
  contact_email: string | null;
  created_at: string;
}

export function assignCam(input: {
  wbsId: string;
  obsId: string;
  contactName?: string;
  contactEmail?: string;
}): Promise<CamAssignment> {
  const { wbsId, ...body } = input;
  return apiRequest<CamAssignment>(`/ram/wbs/${wbsId}/cam`, { method: "POST", body });
}
