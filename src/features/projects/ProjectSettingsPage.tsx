import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings, Info, X, Save } from "lucide-react";
import { Select } from "@shared/components/Select";
import { TextInput } from "@shared/components/TextInput";
import * as projectsApi from "@shared/api/projects";
import * as calendarsApi from "@shared/api/calendars";
import * as calendarHierarchyApi from "@shared/api/calendar-hierarchy";
import { useAuth } from "@shared/auth/AuthContext";
import type { ProjectFolder, ProjectStatus } from "@shared/api/projects";
import { ProjectFormFields, emptyProjectForm } from "./ProjectFormFields";
import type { ProjectFormValues } from "./ProjectFormFields";

// 5.1.1.1.3 — project settings and metadata. Until now a project's name,
// dates, status and folder could be set at creation and never changed again:
// the endpoints existed, nothing called them.
//
// Not a module in the ten-item navigation structure (4.3.1.1.1) and
// deliberately not added to it — this is the current project's own
// configuration, reached from the shell's header, not another module of
// project-controls work.

export function ProjectSettingsPage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  // The enterprise default is platform-wide, not this project's setting, so
  // only a platform admin is offered it — and it appears here rather than in
  // an admin console because no admin console exists yet (Epic 2.4), and
  // leaving the gap open was worse than putting the control where the person
  // who needs it already is.
  const { user } = useAuth();
  const [values, setValues] = useState<ProjectFormValues>(emptyProjectForm);
  const [status, setStatus] = useState<ProjectStatus>("active");
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [templateName, setTemplateName] = useState("");

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => projectsApi.getProject(projectId as string),
    enabled: !!projectId,
  });
  const foldersQuery = useQuery({ queryKey: ["project-folders"], queryFn: projectsApi.listFolders });
  // 9.4.1.1.1 — the calendar the scheduling engine actually reads. Separate
  // from the calendars that merely belong to this project, which is the
  // distinction that made every new project unschedulable.
  const calendarsQuery = useQuery({
    queryKey: ["calendars", projectId],
    queryFn: () => calendarsApi.listCalendars(projectId as string),
    enabled: !!projectId,
  });
  const assignedCalendarQuery = useQuery({
    queryKey: ["project-calendar", projectId],
    queryFn: () => calendarHierarchyApi.getProjectCalendar(projectId as string),
    enabled: !!projectId,
  });
  const tagsQuery = useQuery({ queryKey: ["project-tags"], queryFn: projectsApi.listTags });

  // Seed the form from the loaded project exactly once — re-seeding on every
  // render of fresh data would wipe out whatever the person is mid-way
  // through typing when a background refetch lands.
  useEffect(() => {
    const project = projectQuery.data;
    if (!project) return;
    setValues({
      name: project.name,
      startDate: project.start_date ? project.start_date.slice(0, 10) : "",
      endDate: project.end_date ? project.end_date.slice(0, 10) : "",
      baseCurrency: project.base_currency,
      folderId: project.folder_id === null ? "" : String(project.folder_id),
      tagNames: (project.tags ?? []).map((t) => t.name),
    });
    setStatus(project.status);
  }, [projectQuery.data?.project_id]);

  useEffect(() => {
    if (foldersQuery.data) setFolders(foldersQuery.data);
  }, [foldersQuery.data]);

  const enterpriseCalendarQuery = useQuery({
    queryKey: ["enterprise-calendar"],
    queryFn: calendarHierarchyApi.getEnterpriseDefaultCalendar,
  });

  const enterpriseCalendarMutation = useMutation({
    mutationFn: (calendarId: string) =>
      calendarHierarchyApi.setEnterpriseDefaultCalendar(calendarId === "" ? null : calendarId),
    onSuccess: () => {
      setNotice({
        kind: "info",
        text:
          "Enterprise default calendar set. Every project without its own assignment now inherits this one, " +
          "including projects created from here on.",
      });
      queryClient.invalidateQueries({ queryKey: ["enterprise-calendar"] });
    },
    onError: (error) =>
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Couldn't set the enterprise default calendar.",
      }),
  });

  const calendarMutation = useMutation({
    mutationFn: (calendarId: string) =>
      calendarHierarchyApi.setProjectCalendar(projectId as string, calendarId === "" ? null : calendarId),
    onSuccess: () => {
      setNotice({
        kind: "info",
        text: "Scheduling calendar set. The schedule can now be calculated for this project.",
      });
      queryClient.invalidateQueries({ queryKey: ["project-calendar", projectId] });
    },
    onError: (error) =>
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Couldn't set that calendar.",
      }),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      projectsApi.updateProject(projectId as string, {
        name: values.name.trim(),
        // Blanks have to become explicit nulls: the update endpoint only
        // touches keys present in the body, and an empty string would be
        // written as a real (invalid) date rather than clearing the field.
        start_date: values.startDate || null,
        end_date: values.endDate || null,
        status,
        folder_id: values.folderId === "" ? null : Number(values.folderId),
        tagNames: values.tagNames,
      }),
    onSuccess: () => {
      setNotice({ kind: "info", text: "Project settings saved." });
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      // The name shows in the switcher, the breadcrumb and the project list,
      // all of which read the same cached list.
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) =>
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Couldn't save those settings.",
      }),
  });

  const templateMutation = useMutation({
    mutationFn: () => projectsApi.saveAsTemplate(projectId as string, templateName.trim()),
    onSuccess: (template) => {
      setTemplateName("");
      setNotice({
        kind: "info",
        text: `Saved "${template.name}" as a template. It captures this project's WBS and OBS structure only — not costs, resources, or dates.`,
      });
      queryClient.invalidateQueries({ queryKey: ["project-templates"] });
    },
    onError: (error) =>
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Couldn't save that template.",
      }),
  });

  if (projectQuery.isLoading) {
    return <div className="text-sm text-neutral-500">Loading project settings...</div>;
  }
  if (projectQuery.isError) {
    return (
      <div className="rounded border border-status-error/30 bg-status-error/5 p-4 text-sm text-status-error">
        Couldn&apos;t load this project. {(projectQuery.error as Error)?.message}
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {notice && (
        <div
          className={
            "flex items-start gap-2 rounded border p-3 text-sm " +
            (notice.kind === "error"
              ? "border-status-error/30 bg-status-error/5 text-status-error"
              : "border-status-info/30 bg-status-info/5 text-status-info")
          }
        >
          <Info size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss message">
            <X size={16} />
          </button>
        </div>
      )}

      <section className="rounded bg-white shadow-elevation-1">
        <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3">
          <Settings size={18} className="text-brand-primary" />
          <h1 className="text-lg font-semibold text-neutral-800">Project settings</h1>
        </div>
        <div className="flex flex-col gap-4 p-4">
          <ProjectFormFields
            values={values}
            onChange={setValues}
            folders={folders}
            tags={tagsQuery.data ?? []}
            onFolderCreated={(folder) => setFolders((previous) => [...previous, folder])}
            // Base currency is deliberately not editable after creation: every
            // cost figure already recorded on the project is denominated in
            // it, and changing it here would silently reinterpret them rather
            // than convert them.
            showCurrency={false}
          />
          <Select
            label="Status"
            options={projectsApi.PROJECT_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
            value={status}
            onChange={(e) => setStatus(e.target.value as ProjectStatus)}
          />
          <div className="text-xs text-neutral-500">
            Base currency is {projectQuery.data?.base_currency} and is fixed for the life of the project.
          </div>
          <div>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || values.name.trim() === ""}
              className="flex items-center gap-1.5 rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              <Save size={14} /> {saveMutation.isPending ? "Saving..." : "Save settings"}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded bg-white shadow-elevation-1">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="text-base font-semibold text-neutral-800">Scheduling calendar</h2>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <p className="text-sm text-neutral-600">
            Which calendar the schedule engine counts working days against (9.4.1.1.1). Tasks inherit this
            unless they set their own. Without it the critical path can&apos;t be calculated at all — the
            engine has no way to know which days are working days.
          </p>
          {(calendarsQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-status-warning">
              This project has no calendars yet. Create one from the Calendar module first, then come back
              and assign it here.
            </p>
          ) : (
            <Select
              label="Calendar"
              placeholder="— none assigned —"
              options={(calendarsQuery.data ?? []).map((c) => ({ value: c.calendar_id, label: c.name }))}
              value={assignedCalendarQuery.data?.calendarId ?? ""}
              disabled={calendarMutation.isPending}
              onChange={(e) => calendarMutation.mutate(e.target.value)}
              helperText={
                assignedCalendarQuery.data?.calendarId
                  ? "Saved as soon as you choose — this one setting is what makes a project schedulable."
                  : "No calendar assigned yet, so this project can't be scheduled."
              }
            />
          )}

          {user?.is_platform_admin && (
            <div className="mt-2 border-t border-neutral-200 pt-4">
              <Select
                label="Enterprise default calendar (platform-wide)"
                placeholder="— none set —"
                options={(calendarsQuery.data ?? []).map((c) => ({ value: c.calendar_id, label: c.name }))}
                value={enterpriseCalendarQuery.data?.calendarId ?? ""}
                disabled={enterpriseCalendarMutation.isPending}
                onChange={(e) => enterpriseCalendarMutation.mutate(e.target.value)}
                helperText={
                  enterpriseCalendarQuery.data?.calendarId
                    ? "The fallback for any project, resource or task with no calendar of its own."
                    : "Nothing is set, so a new project can't be scheduled until someone assigns it a calendar by hand. Setting one here fixes that for every project at once."
                }
              />
            </div>
          )}
        </div>
      </section>

      <section className="rounded bg-white shadow-elevation-1">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="text-base font-semibold text-neutral-800">Save as template</h2>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <p className="text-sm text-neutral-600">
            Captures this project&apos;s WBS and OBS structure so a future project can start from it. Cost
            estimates, resources, schedule dates and actuals are deliberately not included (5.1.1.2.1).
          </p>
          <div className="flex items-end gap-2">
            <TextInput
              label="Template name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className="flex-1"
            />
            <button
              onClick={() => templateMutation.mutate()}
              disabled={templateMutation.isPending || templateName.trim() === ""}
              className="rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              {templateMutation.isPending ? "Saving..." : "Save template"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
