import { useLocation } from "react-router-dom";
import { MODULE_LABELS_BY_PATH } from "@shared/ui/nav-structure";

// A genuine placeholder, not a real module screen — same honest pattern as
// the earlier HomePage placeholder. This exists so the real navigation
// structure (4.3.1.1.1) and shell (4.3.1.1.2) can be fully built, routed
// to, and tested end to end — clicking every item in the SidePanel, seeing
// the breadcrumbs update correctly — before any actual module (WBS,
// Calendar, Cost, and the rest) has real content built for it yet.
export function ModulePlaceholderPage(): JSX.Element {
  const location = useLocation();
  const modulePath = location.pathname.split("/")[3];
  const label = MODULE_LABELS_BY_PATH[modulePath] ?? "This module";

  return (
    <div className="rounded border border-dashed border-neutral-300 bg-white p-8 text-center">
      <h1 className="text-lg font-semibold text-neutral-800">{label}</h1>
      <p className="mt-2 text-sm text-neutral-500">
        This screen hasn&apos;t been built yet. The navigation, routing, and layout shell around it are real
        and fully working — this placeholder exists so every module in the real navigation structure can be
        clicked through and tested before any one of them has actual content.
      </p>
    </div>
  );
}
