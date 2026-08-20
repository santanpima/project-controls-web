import { useMemo } from "react";
import type { ScheduleTask, TaskDependency } from "@shared/api/scheduling";
import { floatStanding } from "./schedule-logic";
import {
  computeBounds, barGeometry, progressWidth, generateTicks, xForDate, timelineWidth,
  anchorPoints, dependencyPath, PIXELS_PER_DAY, ROW_HEIGHT, BAR_HEIGHT,
} from "./gantt-scale";
import type { DependencyKind, ZoomLevel } from "./gantt-scale";

// 5.2.1.1.1 — the Gantt, hand-built in SVG rather than delegated to a library.
//
// The reasoning, recorded because it was a real decision: this application's
// backend already computes everything a Gantt library would be bought for —
// the critical path, total and free float, and calendar-aware dates that skip
// each project's own non-working days. What was left is positioning rectangles
// on a time axis, which is arithmetic worth owning and testing (see
// gantt-scale.ts and its tests) rather than importing.
//
// Read-only by design in this pass: dragging a bar to reschedule (5.2.1.1.2)
// is a genuinely separate piece of work, and pretending otherwise by making
// bars look draggable would be worse than leaving them plainly static.

interface GanttChartProps {
  tasks: ScheduleTask[];
  dependencies: TaskDependency[];
  zoom: ZoomLevel;
  today: string; // passed in rather than read from the clock, so this stays pure to render
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}

const NAME_COLUMN_WIDTH = 240;

const BAR_FILL: Record<string, string> = {
  critical: "#B33A3A",   // status-error — on the critical path
  negative: "#B33A3A",   // same colour, distinguished by the hatch overlay below
  slack: "#438DD5",      // brand-accent — has real slack
  unknown: "#A3A3A3",    // neutral — never calculated
};

export function GanttChart({
  tasks, dependencies, zoom, today, selectedTaskId, onSelectTask,
}: GanttChartProps): JSX.Element {
  const bounds = useMemo(() => computeBounds(tasks), [tasks]);

  const rowIndexById = useMemo(() => {
    const map = new Map<string, number>();
    tasks.forEach((task, index) => map.set(task.task_id, index));
    return map;
  }, [tasks]);

  if (!bounds) {
    return (
      <div className="p-8 text-center text-sm text-neutral-500">
        Nothing to draw yet — these tasks haven&apos;t been through the schedule calculation, so they have no
        dates to place on a timeline. Calculate the schedule and the bars will appear.
      </div>
    );
  }

  const width = timelineWidth(bounds, zoom);
  const height = tasks.length * ROW_HEIGHT;
  const ticks = generateTicks(bounds, zoom);
  const todayX = today >= bounds.start && today <= bounds.end ? xForDate(today, bounds, zoom) : null;

  const geometryById = new Map(
    tasks.map((task) => [task.task_id, barGeometry(task, bounds, zoom)])
  );

  return (
    <div className="flex">
      {/* Task names, pinned beside the scrolling timeline so a bar is never
          orphaned from the task it belongs to. Row heights are shared with the
          SVG through one constant, which is what keeps the two columns aligned
          as the list grows. */}
      <div className="shrink-0 border-r border-neutral-200" style={{ width: NAME_COLUMN_WIDTH }}>
        <div className="border-b border-neutral-200 bg-neutral-50 px-3 text-xs font-medium text-neutral-500"
             style={{ height: ROW_HEIGHT, lineHeight: `${ROW_HEIGHT}px` }}>
          Task
        </div>
        {tasks.map((task) => (
          <button
            key={task.task_id}
            onClick={() => onSelectTask(task.task_id)}
            className={
              "block w-full truncate border-b border-neutral-100 px-3 text-left text-sm " +
              (task.task_id === selectedTaskId
                ? "bg-brand-accent/5 font-medium text-brand-primary"
                : "text-neutral-800 hover:bg-neutral-50")
            }
            style={{ height: ROW_HEIGHT, lineHeight: `${ROW_HEIGHT}px` }}
            title={task.name}
          >
            {task.name}
          </button>
        ))}
      </div>

      <div className="min-w-0 flex-1 overflow-x-auto">
        {/* Axis */}
        <svg width={width} height={ROW_HEIGHT} className="block bg-neutral-50" role="presentation">
          <line x1={0} y1={ROW_HEIGHT - 0.5} x2={width} y2={ROW_HEIGHT - 0.5} stroke="#E5E5E5" />
          {ticks.map((tick) => (
            <g key={tick.date}>
              <line x1={tick.x} y1={0} x2={tick.x} y2={ROW_HEIGHT} stroke="#E5E5E5" />
              <text x={tick.x + 4} y={ROW_HEIGHT - 10} fontSize={11} fill="#737373">
                {tick.label}
              </text>
            </g>
          ))}
        </svg>

        <svg width={width} height={height} className="block">
          <defs>
            <marker id="gantt-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="#737373" />
            </marker>
            {/* Negative float gets a hatch as well as the critical colour: it
                isn't merely tight, it's impossible as currently constrained,
                and colour alone would make those two look identical. */}
            <pattern id="gantt-negative" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#B33A3A" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#7A1F1F" strokeWidth="3" />
            </pattern>
          </defs>

          {/* Row banding and vertical gridlines first, so bars sit above them */}
          {tasks.map((task, index) => (
            <rect
              key={`row-${task.task_id}`}
              x={0}
              y={index * ROW_HEIGHT}
              width={width}
              height={ROW_HEIGHT}
              fill={task.task_id === selectedTaskId ? "#438DD514" : index % 2 === 0 ? "#FFFFFF" : "#FAFAFA"}
            />
          ))}
          {ticks.map((tick) => (
            <line key={`grid-${tick.date}`} x1={tick.x} y1={0} x2={tick.x} y2={height} stroke="#F0F0F0" />
          ))}

          {todayX !== null && (
            <g>
              <line x1={todayX} y1={0} x2={todayX} y2={height} stroke="#B36B00" strokeWidth={1.5} strokeDasharray="4 3" />
              <text x={todayX + 3} y={11} fontSize={10} fill="#B36B00">today</text>
            </g>
          )}

          {/* Dependency lines beneath the bars, so a line never obscures the
              thing it connects. */}
          {dependencies.map((dependency) => {
            const from = geometryById.get(dependency.predecessor_task_id);
            const to = geometryById.get(dependency.successor_task_id);
            const fromRow = rowIndexById.get(dependency.predecessor_task_id);
            const toRow = rowIndexById.get(dependency.successor_task_id);
            // A dependency whose tasks aren't both calculated has nowhere to
            // attach — skipped rather than drawn from a guessed position.
            if (!from || !to || fromRow === undefined || toRow === undefined) return null;
            const { start, end } = anchorPoints(
              dependency.dependency_type as DependencyKind, from, to, fromRow, toRow
            );
            return (
              <polyline
                key={dependency.dependency_id}
                points={dependencyPath(start, end)}
                fill="none"
                stroke="#737373"
                strokeWidth={1}
                markerEnd="url(#gantt-arrow)"
              />
            );
          })}

          {/* Bars */}
          {tasks.map((task, index) => {
            const geometry = geometryById.get(task.task_id);
            if (!geometry) return null;
            const standing = floatStanding(task);
            const y = index * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;
            const fill = standing === "negative" ? "url(#gantt-negative)" : BAR_FILL[standing];
            const isMilestone = task.activity_type === "milestone" || geometry.isPoint;
            const filled = progressWidth(task.percent_complete, geometry.width);

            if (isMilestone) {
              // A milestone is a moment, not a span — a diamond, the standard
              // notation, rather than a suspiciously thin bar.
              const cx = geometry.x + Math.min(geometry.width, PIXELS_PER_DAY[zoom]) / 2;
              const cy = index * ROW_HEIGHT + ROW_HEIGHT / 2;
              const r = BAR_HEIGHT / 2;
              return (
                <polygon
                  key={task.task_id}
                  points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`}
                  fill={fill}
                  onClick={() => onSelectTask(task.task_id)}
                  className="cursor-pointer"
                >
                  <title>{`${task.name} — ${task.early_start ?? ""}`}</title>
                </polygon>
              );
            }

            return (
              <g key={task.task_id} onClick={() => onSelectTask(task.task_id)} className="cursor-pointer">
                <rect x={geometry.x} y={y} width={geometry.width} height={BAR_HEIGHT} rx={2} fill={fill} opacity={0.85} />
                {filled !== null && filled > 0 && (
                  <rect x={geometry.x} y={y + 4} width={filled} height={BAR_HEIGHT - 8} rx={1} fill="#FFFFFF" opacity={0.55} />
                )}
                <title>
                  {`${task.name} — ${task.early_start ?? "?"} to ${task.early_finish ?? "?"}` +
                    (standing === "critical"
                      ? " · critical path"
                      : standing === "negative"
                        ? " · negative float: not achievable as constrained"
                        : "")}
                </title>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// A legend belongs with the chart rather than in the page, so the two can't
// drift apart when a colour changes.
export function GanttLegend(): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-4 px-4 py-2 text-xs text-neutral-500">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-4 rounded-sm" style={{ backgroundColor: "#438DD5" }} /> has slack
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-4 rounded-sm" style={{ backgroundColor: "#B33A3A" }} /> critical path
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-2.5 w-4 rounded-sm"
          style={{ backgroundImage: "repeating-linear-gradient(45deg,#B33A3A,#B33A3A 2px,#7A1F1F 2px,#7A1F1F 4px)" }}
        />{" "}
        negative float
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-4 rounded-sm" style={{ backgroundColor: "#A3A3A3" }} /> not calculated
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rotate-45" style={{ backgroundColor: "#438DD5" }} /> milestone
      </span>
      <span className="text-neutral-400">
        Weekends aren&apos;t shaded — non-working days come from each project&apos;s own calendar, which the bars
        already honour.
      </span>
    </div>
  );
}
