import { apiRequest } from "./client";

// Theme 8, Epic 8.3 — the control account dashboard. The RAM grid itself
// (8.3.1.1.2) still has no screen; this is the one endpoint from that Epic the
// Cost module needs, which is the flat list of control accounts a project has
// actually established.
//
// Why Cost needs it: a control account is two separate things that are easy to
// confuse. One is a *classification* on a WBS element (planning_element_type =
// 'control_account'). The other is a *record* linking that element to a
// responsible organization. The time-phased budget requires both — it starts
// from classified elements and joins to the record — so a project can look
// fully classified and still produce an empty budget. Reading this list is how
// the Cost screen tells those two states apart and says which one is missing.
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
