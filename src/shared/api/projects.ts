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
  folderId?: number | null;
  tagNames?: string[];
}

export function createProject(input: CreateProjectInput): Promise<Project> {
  return apiRequest<Project>("/projects", { method: "POST", body: input });
}

// 5.1.1.1.3 — the update endpoint takes raw column names and only touches
// keys actually present in the body, which is why this type is snake_case and
// every field optional: sending a key at all is what marks it for change.
export interface ProjectEditableFields {
  name?: string;
  start_date?: string | null;
  end_date?: string | null;
  status?: ProjectStatus;
  folder_id?: number | null;
  tagNames?: string[];
}

export function updateProject(projectId: string, fields: ProjectEditableFields): Promise<Project> {
  return apiRequest<Project>(`/projects/${projectId}`, { method: "PUT", body: fields });
}

// 5.1.1.1.2 — project folders. A flat list from the API; the folder tree's own
// nesting isn't surfaced yet, since nothing creates nested folders.
export interface ProjectFolder {
  folder_id: number;
  name: string;
  parent_folder_id: number | null;
}

export function listFolders(): Promise<ProjectFolder[]> {
  return apiRequest<ProjectFolder[]>("/projects/folders");
}

export function createFolder(name: string, parentFolderId?: number | null): Promise<ProjectFolder> {
  return apiRequest<ProjectFolder>("/projects/folders", { method: "POST", body: { name, parentFolderId } });
}

export function listTags(): Promise<ProjectTag[]> {
  return apiRequest<ProjectTag[]>("/projects/tags");
}

// 5.1.1.2.1 — templates capture WBS and OBS structure only (deliberately not
// costs, resources or dates), so a project created from one starts with a
// structure and nothing else.
export interface ProjectTemplate {
  template_id: number;
  name: string;
  created_at: string;
}

export function listTemplates(): Promise<ProjectTemplate[]> {
  return apiRequest<ProjectTemplate[]>("/projects/templates");
}

export function saveAsTemplate(projectId: string, name: string): Promise<ProjectTemplate> {
  return apiRequest<ProjectTemplate>("/projects/templates", { method: "POST", body: { projectId, name } });
}

export interface ApplyTemplateInput {
  name: string;
  startDate?: string | null;
  endDate?: string | null;
  baseCurrency?: string;
  folderId?: number | null;
  tagNames?: string[];
}

export function createProjectFromTemplate(templateId: number, input: ApplyTemplateInput): Promise<Project> {
  return apiRequest<Project>(`/projects/templates/${templateId}/apply`, { method: "POST", body: input });
}
