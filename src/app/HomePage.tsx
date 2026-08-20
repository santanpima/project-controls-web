import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Plus } from "lucide-react";
import { useAuth } from "@shared/auth/AuthContext";
import { Modal } from "@shared/components/Modal";
import { Select } from "@shared/components/Select";
import * as projectsApi from "@shared/api/projects";
import type { Project, ProjectFolder, ProjectStatus } from "@shared/api/projects";
import { ProjectFormFields, emptyProjectForm, toCreateInput } from "@features/projects/ProjectFormFields";
import type { ProjectFormValues } from "@features/projects/ProjectFormFields";

// 5.1.2.1.1 — the real project list, replacing the placeholder that linked to
// a literal "demo" project id. Until now every module screen could only be
// reached by typing a project's UUID into the address bar, which was the most
// awkward gap left in the application.
//
// Deliberately a list rather than the sortable/filterable grid that item
// ultimately calls for: no data-grid component exists in this application yet,
// and sorting a handful of projects isn't what makes that component worth
// building. The grid remains that item's own job.

const STATUS_STYLES: Record<ProjectStatus, string> = {
  active: "bg-status-success/10 text-status-success",
  on_hold: "bg-status-warning/10 text-status-warning",
  completed: "bg-status-info/10 text-status-info",
  archived: "bg-neutral-100 text-neutral-500",
};

function formatDateRange(project: Project): string {
  if (!project.start_date && !project.end_date) return "No dates set";
  const start = project.start_date ? project.start_date.slice(0, 10) : "—";
  const end = project.end_date ? project.end_date.slice(0, 10) : "—";
  return `${start} to ${end}`;
}

export function HomePage(): JSX.Element {
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ProjectFormValues>(emptyProjectForm);
  const [templateId, setTemplateId] = useState("");
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [error, setError] = useState<string | null>(null);

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: projectsApi.listProjects });
  const foldersQuery = useQuery({ queryKey: ["project-folders"], queryFn: projectsApi.listFolders });
  const tagsQuery = useQuery({ queryKey: ["project-tags"], queryFn: projectsApi.listTags });
  const templatesQuery = useQuery({ queryKey: ["project-templates"], queryFn: projectsApi.listTemplates });

  useEffect(() => {
    if (foldersQuery.data) setFolders(foldersQuery.data);
  }, [foldersQuery.data]);

  const createMutation = useMutation({
    // 5.1.1.1.1 — creating from a template and creating from scratch are two
    // different endpoints, not one endpoint with a flag, so the choice is made
    // here rather than pushed into the request body.
    mutationFn: () => {
      const input = toCreateInput(form);
      return templateId === ""
        ? projectsApi.createProject(input)
        : projectsApi.createProjectFromTemplate(Number(templateId), input);
    },
    onSuccess: () => {
      setCreating(false);
      setForm(emptyProjectForm);
      setTemplateId("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Couldn't create that project."),
  });

  const projects = projectsQuery.data ?? [];
  const folderName = (id: number | null) =>
    id === null ? null : (folders.find((f) => f.folder_id === id)?.name ?? null);

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-brand-primary">
            Welcome{user?.first_name ? `, ${user.first_name}` : ""}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">Signed in as {user?.email}</p>
        </div>
        <button
          onClick={signOut}
          className="rounded border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          Sign out
        </button>
      </div>

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-800">Projects</h2>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1 rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white"
        >
          <Plus size={16} /> New project
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded border border-status-error/30 bg-status-error/5 p-3 text-sm text-status-error">
          {error}
        </div>
      )}

      {projectsQuery.isLoading ? (
        <div className="mt-4 text-sm text-neutral-500">Loading projects...</div>
      ) : projectsQuery.isError ? (
        <div className="mt-4 rounded border border-status-error/30 bg-status-error/5 p-4 text-sm text-status-error">
          Couldn&apos;t load your projects. {(projectsQuery.error as Error)?.message}
        </div>
      ) : projects.length === 0 ? (
        <div className="mt-4 rounded border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          No projects yet. Create one to start building a WBS, an org chart, and a schedule.
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-neutral-100 rounded bg-white shadow-elevation-1">
          {projects.map((project) => (
            <li key={project.project_id}>
              {/* Landing on WBS deliberately: it's the structure every other
                  module keys off, and one of the two modules with a real
                  screen today. */}
              <Link
                to={`/projects/${project.project_id}/wbs`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50"
              >
                <FolderOpen size={18} className="shrink-0 text-brand-accent" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-neutral-800">{project.name}</div>
                  <div className="text-xs text-neutral-500">
                    {formatDateRange(project)} · {project.base_currency}
                    {folderName(project.folder_id) ? ` · ${folderName(project.folder_id)}` : ""}
                  </div>
                </div>
                <span className={"rounded px-1.5 py-0.5 text-xs font-medium " + STATUS_STYLES[project.status]}>
                  {projectsApi.PROJECT_STATUSES.find((s) => s.value === project.status)?.label ?? project.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New project">
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          <ProjectFormFields
            values={form}
            onChange={setForm}
            folders={folders}
            tags={tagsQuery.data ?? []}
            onFolderCreated={(folder) => setFolders((previous) => [...previous, folder])}
          />
          {(templatesQuery.data ?? []).length > 0 && (
            <Select
              label="Start from a template"
              placeholder="— empty project —"
              options={(templatesQuery.data ?? []).map((t) => ({
                value: String(t.template_id),
                label: t.name,
              }))}
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              helperText="A template carries WBS and OBS structure only — no costs, resources or dates."
            />
          )}
          <div className="flex gap-2">
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || form.name.trim() === ""}
              className="rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {createMutation.isPending ? "Creating..." : "Create project"}
            </button>
            <button
              onClick={() => setCreating(false)}
              className="rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
