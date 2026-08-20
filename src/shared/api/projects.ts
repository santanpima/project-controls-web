import { apiRequest } from "./client";

// Theme 5 — the real Project entity. Note this is the one router in the
// backend that requires authentication but no module permission: the
// permission matrix (2.2.1.1.2) has no "projects" module in its own list,
// so any signed-in user can read the project list.

export type ProjectStatus = "active" | "on_hold" | "completed" | "archived";

export const PROJECT_STATUSES: { value: ProjectStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On hold" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
];

export interface Project {
  project_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: ProjectStatus;
  base_currency: string;
  owner_id: string | null;
  folder_id: number | null;
  calendar_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectTag {
  tag_id: number;
  name: string;
}

// Already sorted by name server-side.
export function listProjects(): Promise<Project[]> {
  return apiRequest<Project[]>("/projects");
}

export function getProject(projectId: string): Promise<Project & { tags: ProjectTag[] }> {
  return apiRequest<Project & { tags: ProjectTag[] }>(`/projects/${projectId}`);
}

export interface CreateProjectInput {
  name: string;
  startDate?: string | null;
  endDate?: string | null;
  baseCurrency?: string;
}

export function createProject(input: CreateProjectInput): Promise<Project> {
  return apiRequest<Project>("/projects", { method: "POST", body: input });
}
