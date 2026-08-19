import { createContext, useContext, useState, useEffect, ReactNode } from "react";

// Per 4.5.1.1's own state-management table: sidebar collapsed/expanded is
// genuinely global state needed by unrelated components (NavBar's toggle
// button and SidePanel itself), which is exactly the bar that table sets
// for using Context rather than local state. No dedicated ProjectContext
// exists for the same reason that table gives — projectId comes free from
// the route, current project metadata is just another query — so this
// context deliberately stays narrow to only what actually needs it.
const SIDEBAR_STORAGE_KEY = "pc_sidebar_collapsed";

interface UIContextValue {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  // Mobile's hamburger-drawer state (4.3.1.1.2) is deliberately separate
  // from desktop/tablet's collapsed state — closing the mobile drawer
  // shouldn't collapse the desktop sidebar the next time the window is
  // wide, and vice versa.
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
}

const UIContext = createContext<UIContextValue | undefined>(undefined);

export function UIProvider({ children }: { children: ReactNode }): JSX.Element {
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
    } catch {
      // Private browsing / storage disabled — default to expanded rather
      // than let a storage error break the whole app shell.
      return false;
    }
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed));
    } catch {
      // Ignore — persistence is a nicety, not a requirement for the app to work.
    }
  }, [sidebarCollapsed]);

  const toggleSidebar = () => setSidebarCollapsed((prev) => !prev);

  const value: UIContextValue = { sidebarCollapsed, toggleSidebar, mobileNavOpen, setMobileNavOpen };
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI(): UIContextValue {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used within a UIProvider");
  return ctx;
}
