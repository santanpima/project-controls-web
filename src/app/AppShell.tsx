import { Outlet, useParams, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import * as projectsApi from "@shared/api/projects";
import { NavBar } from "@shared/components/NavBar";
import { SidePanel } from "@shared/components/SidePanel";
import { Breadcrumbs, BreadcrumbSegment } from "@shared/components/Breadcrumbs";
import { useUI } from "@shared/ui/UIContext";
import { NAV_STRUCTURE, MODULE_LABELS_BY_PATH } from "@shared/ui/nav-structure";

// 4.3.1.1.2's region table, assembled: NavBar fixed top/full-width; SidePanel
// fixed left below it, scrolling independently; Breadcrumbs at the top of
// the content area (not inside SidePanel); content area is the only region
// that scrolls with page content, rendering the routed module via Outlet.
export function AppShell(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const { sidebarCollapsed, mobileNavOpen, setMobileNavOpen } = useUI();

  const basePath = `/projects/${projectId}`;
  const currentModulePath = location.pathname.split("/")[3]; // /projects/:id/{module}
  const currentModuleLabel =
    MODULE_LABELS_BY_PATH[currentModulePath] ?? (currentModulePath === "settings" ? "Settings" : "");

  // Breadcrumb pattern per 4.3.1.1.1: "Project Name → Module → drill-down
  // path." The project name is real now that a project list exists; it
  // falls back to the raw id while the list is still loading, rather than
  // rendering an empty crumb. Deeper tree drill-down segments (WBS/OBS) get
  // appended by those module screens themselves once they exist; this
  // component doesn't need to know about that in advance.
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: projectsApi.listProjects });
  const projectName = projectsQuery.data?.find((p) => p.project_id === projectId)?.name;

  const breadcrumbSegments: BreadcrumbSegment[] = [
    { label: projectName ?? projectId ?? "Project", path: basePath },
    ...(currentModuleLabel ? [{ label: currentModuleLabel }] : []),
  ];

  // Content area padding has to match the SidePanel's own fixed width
  // exactly (icon-only on tablet, then the same collapsed/expanded toggle
  // applied at xl) — kept in sync deliberately here since these are two
  // separate elements that have to agree, not one that automatically
  // follows the other.
  const contentPaddingClass = `pt-14 md:pl-16 ${sidebarCollapsed ? "xl:pl-16" : "xl:pl-64"}`;

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar />
      <SidePanel
        sections={NAV_STRUCTURE}
        basePath={basePath}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />
      <div className={contentPaddingClass}>
        <Breadcrumbs segments={breadcrumbSegments} />
        <main className="p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
