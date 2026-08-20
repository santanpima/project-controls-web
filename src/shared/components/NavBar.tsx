import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Menu, ChevronDown, LogOut, Check, FolderOpen, LayoutGrid, Settings } from "lucide-react";
import { useAuth } from "@shared/auth/AuthContext";
import { useUI } from "@shared/ui/UIContext";
import * as projectsApi from "@shared/api/projects";

// 4.2.2.1.3's own wording — "no role-based menu items, consistent with the
// full-access, no-in-app-RBAC model (ADR-001)" — reasons from a framing the
// project has since superseded: ADR-001's single-access-level scope was
// explicitly replaced when Theme 2 reintroduced real roles and permissions.
// The NavBar still shows the same items to everyone, but now for a defensible
// reason rather than that one: nothing in it is an action a role could lack.
// Where a role genuinely changes what's possible — creating, editing and
// deleting inside a module — the module screens themselves decide (2.2.1.2.2),
// against the permission list the API now returns.
export function NavBar(): JSX.Element {
  const { user, signOut } = useAuth();
  const { toggleSidebar, sidebarCollapsed, mobileNavOpen, setMobileNavOpen } = useUI();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const displayName = user?.first_name || user?.email || "";

  // The NavBar only ever renders inside the project shell, so the path is
  // /projects/:projectId/:module — switching project keeps whichever module
  // the person is already looking at, which is the whole point of a switcher
  // (comparing the same view across projects), rather than dumping them back
  // at a landing page.
  const [, , currentProjectId, currentModule] = location.pathname.split("/");

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: projectsApi.listProjects });
  const projects = projectsQuery.data ?? [];
  const currentProject = projects.find((p) => p.project_id === currentProjectId);

  function switchTo(projectId: string) {
    setProjectMenuOpen(false);
    navigate(`/projects/${projectId}/${currentModule || "wbs"}`);
  }

  return (
    <header className="fixed top-0 left-0 right-0 h-14 z-50 flex items-center justify-between bg-brand-primary text-white px-4 shadow-elevation-1">
      <div className="flex items-center gap-3">
        {/* Mobile hamburger — desktop/tablet use the sidebar's own collapse
            toggle instead (4.3.1.1.2's two separate mechanisms). */}
        <button
          className="md:hidden p-1 rounded hover:bg-white/10"
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
          aria-label="Toggle navigation menu"
        >
          <Menu size={22} />
        </button>
        {/* Desktop/tablet sidebar collapse toggle — hidden on mobile, since
            mobile's sidebar visibility is controlled by the hamburger above
            instead, not this collapsed/expanded preference. */}
        <button
          className="hidden md:block p-1 rounded hover:bg-white/10"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
        >
          <Menu size={20} />
        </button>
        {/* The way back to the project list. Without this, a person inside a
            project could only reach it by editing the URL — the switcher lists
            existing projects but offers no route to creating one. */}
        <Link to="/" className="font-semibold text-lg tracking-tight hover:text-white/90">
          Project Controls
        </Link>
      </div>

      {/* Project switcher (4.2.2.1.3) — now wired to the real project list.
          Distinct from the SidePanel, which switches module within the
          current project; this switches which project you're in at all,
          holding the current module steady. */}
      <div className="flex-1 flex justify-center">
        <div className="relative">
          <button
            className="flex items-center gap-2 px-3 py-1.5 rounded bg-white/10 text-sm text-white/90 hover:bg-white/15 disabled:opacity-60"
            onClick={() => setProjectMenuOpen(!projectMenuOpen)}
            disabled={projectsQuery.isLoading}
            aria-haspopup="listbox"
            aria-expanded={projectMenuOpen}
          >
            <FolderOpen size={15} />
            <span className="max-w-[16rem] truncate">
              {projectsQuery.isLoading
                ? "Loading projects..."
                : currentProject
                  ? currentProject.name
                  : "Select a project"}
            </span>
            <ChevronDown size={16} />
          </button>
          {projectMenuOpen && (
            <div
              role="listbox"
              className="absolute left-1/2 z-50 mt-1 max-h-80 w-72 -translate-x-1/2 overflow-y-auto rounded bg-white py-1 text-neutral-900 shadow-elevation-2"
            >
              <Link
                to="/"
                onClick={() => setProjectMenuOpen(false)}
                className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                <LayoutGrid size={14} /> All projects
              </Link>
              {projects.length === 0 ? (
                <div className="px-4 py-2 text-sm text-neutral-500">
                  No projects yet — create one from the home page.
                </div>
              ) : (
                projects.map((project) => (
                  <button
                    key={project.project_id}
                    role="option"
                    aria-selected={project.project_id === currentProjectId}
                    onClick={() => switchTo(project.project_id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50"
                  >
                    <span className="w-4 shrink-0">
                      {project.project_id === currentProjectId && <Check size={14} className="text-brand-accent" />}
                    </span>
                    <span className="truncate">{project.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1">
        {currentProjectId && (
          <Link
            to={`/projects/${currentProjectId}/settings`}
            className="rounded p-2 hover:bg-white/10"
            title="Project settings"
            aria-label="Project settings"
          >
            <Settings size={18} />
          </Link>
        )}
      <div className="relative">
        <button
          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/10"
          onClick={() => setUserMenuOpen(!userMenuOpen)}
        >
          <span className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-sm font-medium">
            {displayName.charAt(0).toUpperCase()}
          </span>
          <span className="hidden sm:inline text-sm">{displayName}</span>
          <ChevronDown size={14} />
        </button>
        {userMenuOpen && (
          <div className="absolute right-0 mt-1 w-48 rounded bg-white text-neutral-900 shadow-elevation-2 py-1">
            <div className="px-4 py-2 text-sm text-neutral-500 border-b border-neutral-100">{user?.email}</div>
            <button
              className="w-full text-left px-4 py-2 text-sm flex items-center gap-2 hover:bg-neutral-50"
              onClick={signOut}
            >
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        )}
      </div>
      </div>
    </header>
  );
}
