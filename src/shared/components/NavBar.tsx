import { useState } from "react";
import { Menu, ChevronDown, LogOut } from "lucide-react";
import { useAuth } from "@shared/auth/AuthContext";
import { useUI } from "@shared/ui/UIContext";

// 4.2.2.1.3 — "No role-based menu items — consistent with the full-access,
// no-in-app-RBAC model (ADR-001)." Every signed-in user sees the identical
// NavBar; there's nothing here to conditionally show or hide by role.
export function NavBar(): JSX.Element {
  const { user, signOut } = useAuth();
  const { toggleSidebar, sidebarCollapsed, mobileNavOpen, setMobileNavOpen } = useUI();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const displayName = user?.first_name || user?.email || "";

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
        <span className="font-semibold text-lg tracking-tight">Project Controls</span>
      </div>

      {/* Project switcher slot — structurally present per 4.2.2.1.3, but
          genuinely not wired to real data yet: no project-list or
          project-creation frontend exists at this point, only the backend
          API for it. Flagged honestly here rather than faked with mock
          data; this becomes a real dropdown once that frontend work exists. */}
      <div className="flex-1 flex justify-center">
        <button
          className="flex items-center gap-2 px-3 py-1.5 rounded bg-white/10 text-sm text-white/90 hover:bg-white/15"
          disabled
          title="Project switching isn't built yet"
        >
          <span>Select a project</span>
          <ChevronDown size={16} />
        </button>
      </div>

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
    </header>
  );
}
