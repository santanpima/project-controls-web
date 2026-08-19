import { NavLink } from "react-router-dom";
import type { NavSection } from "../ui/nav-structure";

interface SidePanelProps {
  sections: NavSection[];
  basePath: string; // e.g. "/projects/abc-123" — module paths are relative to this
  collapsed: boolean; // desktop-only manual toggle (4.5.1.1's persisted preference)
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

// Per 4.3.1.1.2's responsive table, three genuinely different behaviors:
//   Mobile  (below md):  hidden entirely, opens as an overlay drawer
//   Tablet  (md–xl):     always icon-only, regardless of any user preference
//   Desktop (xl+):       expanded by default, but respects the user's own
//                        collapsed/expanded toggle (4.5.1.1's persisted state)
// The `collapsed` prop only takes visual effect at the xl breakpoint and up
// (via the xl: prefix below) — tablet's icon-only behavior is structural,
// not a user choice, exactly as the spec's table states.
export function SidePanel({ sections, basePath, collapsed, mobileOpen, onCloseMobile }: SidePanelProps): JSX.Element {
  const widthClass = collapsed ? "xl:w-16" : "xl:w-64";

  const content = (
    <nav className="flex flex-col gap-6 overflow-y-auto py-4">
      {sections.map((section) => (
        <div key={section.label}>
          <div className="px-4 mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400 xl:block hidden">
            {collapsed ? "" : section.label}
          </div>
          <ul className="flex flex-col gap-0.5">
            {section.modules.map((mod) => {
              const Icon = mod.icon;
              return (
                <li key={mod.key}>
                  <NavLink
                    to={`${basePath}/${mod.path}`}
                    onClick={onCloseMobile}
                    className={({ isActive }) =>
                      "flex items-center gap-3 px-4 py-2 text-sm rounded-none " +
                      (isActive
                        ? "bg-brand-primary/10 text-brand-primary font-medium border-l-2 border-brand-primary"
                        : "text-neutral-700 hover:bg-neutral-100 border-l-2 border-transparent")
                    }
                    title={mod.label}
                  >
                    <Icon size={18} className="shrink-0" />
                    <span className="md:hidden xl:inline">{mod.label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      {/* Desktop + tablet: persistent, fixed left, below the NavBar, scrolls
          independently of the content area (4.3.1.1.2). */}
      <aside
        className={
          "hidden md:flex md:w-16 " + widthClass +
          " shrink-0 flex-col border-r border-neutral-200 bg-white fixed top-14 bottom-0 left-0 transition-[width]"
        }
      >
        {content}
      </aside>

      {/* Mobile: hidden entirely behind the NavBar's hamburger toggle, opens
          as a full overlay drawer on top of the content area rather than
          pushing it aside (4.3.1.1.2). */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="w-72 bg-white flex flex-col shadow-elevation-3">{content}</div>
          <div className="flex-1 bg-black/30" onClick={onCloseMobile} aria-hidden="true" />
        </div>
      )}
    </>
  );
}
