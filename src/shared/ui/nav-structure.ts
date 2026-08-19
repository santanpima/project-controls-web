import {
  ListTree, Users2, CalendarDays, HardHat, GanttChartSquare,
  DollarSign, ShieldAlert, Rows3, LineChart, FileBarChart,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavModule {
  key: string;
  label: string;
  path: string; // relative to /projects/:projectId/
  icon: LucideIcon;
}

export interface NavSection {
  label: string;
  modules: NavModule[];
}

// The exact structure specified in 4.3.1.1.1 — ten modules grouped by where
// they sit in a project controls workflow, not a flat list. Section order
// and module order within each section both match the spec's own table.
export const NAV_STRUCTURE: NavSection[] = [
  {
    label: "Planning",
    modules: [
      { key: "wbs", label: "WBS", path: "wbs", icon: ListTree },
      { key: "obs", label: "OBS", path: "obs", icon: Users2 },
      { key: "calendars", label: "Calendar", path: "calendars", icon: CalendarDays },
      { key: "resources", label: "Resources", path: "resources", icon: HardHat },
      { key: "schedule", label: "Schedule", path: "schedule", icon: GanttChartSquare },
    ],
  },
  {
    label: "Execution",
    modules: [
      { key: "cost", label: "Cost", path: "cost", icon: DollarSign },
      { key: "risk", label: "Risk", path: "risk", icon: ShieldAlert },
      { key: "agile", label: "Agile", path: "agile", icon: Rows3 },
    ],
  },
  {
    label: "Analysis",
    modules: [
      { key: "evm", label: "EVM", path: "evm", icon: LineChart },
    ],
  },
  {
    label: "Reporting",
    modules: [
      { key: "reports", label: "Reporting & Data Exchange", path: "reports", icon: FileBarChart },
    ],
  },
];

// Flat lookup, built once — Breadcrumbs needs "given this path segment,
// what's its display label" without caring about section grouping at all.
export const MODULE_LABELS_BY_PATH: Record<string, string> = Object.fromEntries(
  NAV_STRUCTURE.flatMap((section) => section.modules.map((m) => [m.path, m.label]))
);
