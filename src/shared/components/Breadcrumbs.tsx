import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

export interface BreadcrumbSegment {
  label: string;
  path?: string; // omitted for the final/current segment, which isn't a link
}

// 4.2.2.1.3 — generic on purpose: the flat "Project Name → Module" pattern
// and the deeper "Project Name → WBS → 1.2 Design Phase → 1.2.3 Structural
// Drawings" tree-drilldown pattern are both just longer or shorter
// segment lists to this same component, not two different components.
export function Breadcrumbs({ segments }: { segments: BreadcrumbSegment[] }): JSX.Element {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 px-4 py-2 text-sm text-neutral-500">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={14} className="text-neutral-300" />}
            {seg.path && !isLast ? (
              <Link to={seg.path} className="hover:text-brand-primary hover:underline">
                {seg.label}
              </Link>
            ) : (
              <span className={isLast ? "text-neutral-900 font-medium" : ""}>{seg.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
