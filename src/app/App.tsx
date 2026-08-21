import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@shared/auth/AuthContext";
import { RequireAuth } from "@shared/auth/RequireAuth";
import { UIProvider } from "@shared/ui/UIContext";
import { NAV_STRUCTURE } from "@shared/ui/nav-structure";
import { LoginPage } from "@features/auth/LoginPage";
import { RegisterPage } from "@features/auth/RegisterPage";
import { CalendarPage } from "@features/calendars/CalendarPage";
import { WbsPage } from "@features/wbs/WbsPage";
import { ObsPage } from "@features/obs/ObsPage";
import { SchedulePage } from "@features/schedule/SchedulePage";
import { ResourcesPage } from "@features/resources/ResourcesPage";
import { ProjectSettingsPage } from "@features/projects/ProjectSettingsPage";
import { HomePage } from "./HomePage";
import { AppShell } from "./AppShell";
import { ModulePlaceholderPage } from "./ModulePlaceholderPage";

// 4.1.1.1.2 — client-side routing via React Router. Module routes now
// genuinely exist, scoped under /projects/:projectId/{module} exactly as
// specified, rendering inside the real AppShell (4.3.1.1.2) rather than
// standalone — every module in the real navigation structure (4.3.1.1.1)
// is reachable and shows the actual shell. Calendar (9.1.2.2.1), WBS
// (7.1.1.2.1 / 7.1.2.1.2) and OBS (8.1.1.1.3 / 8.1.1.2.1) are now real
// screens, joined by Schedule (12.2.1.1.1 / 12.2.2.1.1 / 12.3.1.1.1–3) and
// Resources (10.1.2.1.3 / 10.2.1.1.3 / 10.2.1.2.1);
// every other module still renders the honest placeholder until that
// screen's own work is built.
const ALL_MODULE_PATHS = NAV_STRUCTURE.flatMap((section) => section.modules.map((m) => m.path));
const REAL_MODULE_SCREENS: Record<string, () => JSX.Element> = {
  calendars: CalendarPage,
  wbs: WbsPage,
  obs: ObsPage,
  schedule: SchedulePage,
  resources: ResourcesPage,
};

export function App(): JSX.Element {
  return (
    <AuthProvider>
      <UIProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route element={<RequireAuth />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/projects/:projectId" element={<AppShell />}>
                {/* Project settings (5.1.1.1.3) sits inside the shell but is
                    deliberately not one of the ten navigation modules — it
                    configures the current project rather than being another
                    area of project-controls work. */}
                <Route path="settings" element={<ProjectSettingsPage />} />
                {ALL_MODULE_PATHS.map((path) => {
                  const RealScreen = REAL_MODULE_SCREENS[path];
                  return (
                    <Route
                      key={path}
                      path={path}
                      element={RealScreen ? <RealScreen /> : <ModulePlaceholderPage />}
                    />
                  );
                })}
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </UIProvider>
    </AuthProvider>
  );
}
