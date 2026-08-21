import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown, ChevronRight, Plus, Pencil, Trash2, Info, X, AlertTriangle, Tag,
} from "lucide-react";
import { useAuth } from "@shared/auth/AuthContext";
import { readOnlyReason } from "@shared/auth/permissions";
import { Modal } from "@shared/components/Modal";
import { Select } from "@shared/components/Select";
import { Tabs } from "@shared/components/Tabs";
import * as budgetApi from "@shared/api/budget";
import * as wbsApi from "@shared/api/wbs";
import * as projectsApi from "@shared/api/projects";
import * as calendarsApi from "@shared/api/calendars";
import * as calendarHierarchyApi from "@shared/api/calendar-hierarchy";
import * as ramApi from "@shared/api/ram";
import type { Estimate, PlanningElementType } from "@shared/api/budget";
import { buildTree, flattenVisible, idsWithChildren } from "@features/wbs/wbs-tree";
import {
  rollUpBudget, projectTotal, phaseByPeriod, describeTotal, formatMoney,
  estimateValue, timePhasedAvailability, elementsUnderAControlAccount, EMPTY_TOTAL,
} from "./budget-rollup";
import { EstimateFormModal } from "./EstimateFormModal";
import { BaselinePanel } from "./BaselinePanel";

// Theme 11, Epic 11.4 — the Cost module.
//
// The organizing idea: a budget in this application is never typed in. There
// is no budget table and no editable budget field anywhere. A budget figure is
// derived, live, by summing quantity x rate over the estimates attached to WBS
// elements. So this screen is the WBS tree with money on it — the same tree the
// WBS module shows, carrying each element's own estimates and the total of
// everything beneath it.
//
// Two permission modules meet here, as they did on Resources. Estimates,
// baselines and change requests are governed by "cost". Classifying a WBS
// element as a control account or work package is governed by "scheduling",
// because that endpoint is mounted under the scheduling router. A role can
// hold one without the other, so the two are checked separately.

type Notice = { kind: "info" | "error" | "success"; text: string } | null;

export function CostPage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const { user, can } = useAuth();

  const canCreateCost = can("cost", "create");
  const canUpdateCost = can("cost", "update");
  const canDeleteCost = can("cost", "delete");
  const canClassify = can("scheduling", "update");
  const readOnly = !canCreateCost && !canUpdateCost && !canDeleteCost;

  const [tab, setTab] = useState("tree");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedWbsId, setSelectedWbsId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [estimateForm, setEstimateForm] = useState<{ wbsId: string; estimate: Estimate | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Estimate | null>(null);
  const [classifying, setClassifying] = useState<{ wbsId: string; code: string; name: string } | null>(null);
  const didAutoExpand = useRef(false);

  // --- Data ------------------------------------------------------------------

  const wbsQuery = useQuery({
    queryKey: ["wbs", projectId],
    queryFn: () => wbsApi.listWbsElements(projectId as string),
    enabled: !!projectId,
  });
  const estimatesQuery = useQuery({
    queryKey: ["budget-estimates", projectId],
    queryFn: () => budgetApi.listEstimates(projectId as string),
    enabled: !!projectId,
  });
  const statusQuery = useQuery({
    queryKey: ["budget-status", projectId],
    queryFn: () => budgetApi.getBudgetStatus(projectId as string),
    enabled: !!projectId,
  });
  const baselinesQuery = useQuery({
    queryKey: ["budget-baselines", projectId],
    queryFn: () => budgetApi.listBaselines(projectId as string),
    enabled: !!projectId,
  });
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => projectsApi.getProject(projectId as string),
    enabled: !!projectId,
  });
  const controlAccountsQuery = useQuery({
    queryKey: ["control-accounts", projectId],
    queryFn: () => ramApi.listControlAccounts(projectId as string),
    enabled: !!projectId,
  });
  const projectCalendarQuery = useQuery({
    queryKey: ["project-calendar", projectId],
    queryFn: () => calendarHierarchyApi.getProjectCalendar(projectId as string),
    enabled: !!projectId,
  });
  const calendarId = projectCalendarQuery.data?.calendarId ?? null;
  const periodsQuery = useQuery({
    queryKey: ["fiscal-periods", calendarId],
    queryFn: () => calendarsApi.listFiscalPeriods(calendarId as string),
    enabled: !!calendarId,
  });

  // 11.4.1.1.1 itself — the formal budget-period rollup, computed server-side
  // by control account. Fetched alongside the client-side phasing rather than
  // instead of it: the two answer different questions and can legitimately
  // disagree, which the screen shows rather than hides. See the note where
  // both are rendered.
  const budgetPeriodsQuery = useQuery({
    queryKey: ["budget-periods", projectId],
    queryFn: () => budgetApi.listBudgetPeriods(projectId as string),
    enabled: !!projectId,
  });

  const activeBaselineId = statusQuery.data?.activeBaseline?.budget_baseline_id ?? null;
  const changeRequestsQuery = useQuery({
    queryKey: ["budget-change-requests", activeBaselineId],
    queryFn: () => budgetApi.listChangeRequests(activeBaselineId as number),
    enabled: activeBaselineId !== null,
  });

  // --- Derived ---------------------------------------------------------------

  const elements = useMemo(() => wbsQuery.data ?? [], [wbsQuery.data]);
  const estimates = useMemo(() => estimatesQuery.data ?? [], [estimatesQuery.data]);
  const periods = useMemo(() => periodsQuery.data ?? [], [periodsQuery.data]);
  const currencyCode = projectQuery.data?.base_currency ?? null;
  const isBaselined = statusQuery.data?.isBaselined ?? false;

  const rollup = useMemo(() => rollUpBudget(elements, estimates), [elements, estimates]);
  const total = useMemo(() => projectTotal(elements, rollup), [elements, rollup]);
  const tree = useMemo(() => buildTree(elements), [elements]);
  const rows = useMemo(() => flattenVisible(tree, expandedIds), [tree, expandedIds]);
  const parentIds = useMemo(() => idsWithChildren(elements), [elements]);

  const estimatesByWbs = useMemo(() => {
    const map = new Map<string, Estimate[]>();
    for (const estimate of estimates) {
      const existing = map.get(estimate.wbs_id);
      if (existing) existing.push(estimate);
      else map.set(estimate.wbs_id, [estimate]);
    }
    return map;
  }, [estimates]);

  const underAControlAccount = useMemo(() => elementsUnderAControlAccount(elements), [elements]);

  const controlAccountWbsIds = useMemo(
    () => new Set((controlAccountsQuery.data ?? []).map((ca) => ca.wbs_id)),
    [controlAccountsQuery.data]
  );
  const phasing = useMemo(() => timePhasedAvailability(elements, controlAccountWbsIds), [elements, controlAccountWbsIds]);
  // Whether the formal rollup HAS anything is answered by the rollup itself,
  // not inferred from the control-account list. The list is only consulted to
  // explain WHY it is empty, and only once it has actually loaded — otherwise
  // a slow or failed RAM request made the page assert, wrongly and
  // permanently, that no control accounts existed.
  const rollupHasRows = (budgetPeriodsQuery.data ?? []).length > 0;
  const diagnosisReady = !controlAccountsQuery.isLoading && !controlAccountsQuery.isError;
  const periodColumns = useMemo(() => phaseByPeriod(estimates, periods), [estimates, periods]);

  // The server's rollup returns bare ids; these are only meaningful next to the
  // WBS code and the period they belong to, so the labels are resolved once
  // here rather than inside the render.
  const controlAccountRollup = useMemo(() => {
    const periodsById = new Map(periods.map((p) => [p.fiscal_period_id, p]));
    return (budgetPeriodsQuery.data ?? []).map((row) => {
      const element = elements.find((e) => e.wbs_id === row.control_account_wbs_id);
      const period = periodsById.get(row.fiscal_period_id);
      return {
        ...row,
        label: element ? `${element.code} ${element.name}` : row.control_account_wbs_id,
        periodLabel: period ? `P${period.period_number} · ${period.start_date.slice(0, 10)}` : "unknown period",
      };
    });
  }, [budgetPeriodsQuery.data, elements, periods]);

  const selected = elements.find((e) => e.wbs_id === selectedWbsId) ?? null;
  const selectedEstimates = selectedWbsId ? estimatesByWbs.get(selectedWbsId) ?? [] : [];

  // Open the tree to its first two levels on arrival, once. A collapsed root is
  // an unhelpful first impression of a screen whose whole point is the numbers.
  useEffect(() => {
    if (didAutoExpand.current || elements.length === 0) return;
    didAutoExpand.current = true;
    setExpandedIds(new Set(elements.filter((e) => e.level <= 2).map((e) => e.wbs_id)));
  }, [elements]);

  // --- Mutations -------------------------------------------------------------

  function reportError(error: unknown) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : "Something went wrong.";
    setNotice({ kind: "error", text: message });
  }

  function refreshBudget() {
    queryClient.invalidateQueries({ queryKey: ["budget-estimates", projectId] });
    queryClient.invalidateQueries({ queryKey: ["budget-status", projectId] });
    queryClient.invalidateQueries({ queryKey: ["budget-change-requests", activeBaselineId] });
    // The server-side control-account rollup is derived from exactly the rows
    // that just changed. Leaving it out meant a saved estimate moved the tree
    // and not the EIA-748 table beside it.
    queryClient.invalidateQueries({ queryKey: ["budget-periods", projectId] });
  }

  const changeMutation = useMutation({
    mutationFn: (vars: { change: budgetApi.EstimateChange; description: string }) =>
      budgetApi.submitEstimateChange({
        projectId: projectId as string,
        change: vars.change,
        description: vars.description,
        requestedBy: user?.user_id,
      }),
    onSuccess: (result, vars) => {
      setEstimateForm(null);
      setPendingDelete(null);
      refreshBudget();
      // A 202 carrying a change request is a different outcome from a save, not
      // an error. Saying "saved" here would be a lie the person only discovers
      // when the number on the tree doesn't move.
      if (budgetApi.isGatedEstimate(result)) {
        setNotice({
          kind: "info",
          text: "Submitted for approval. The budget won't change until someone else approves it.",
        });
      } else {
        setNotice({
          kind: "success",
          text: vars.change.action === "remove" ? "Estimate removed." : "Estimate saved.",
        });
      }
    },
    onError: (error) => {
      setEstimateForm(null);
      setPendingDelete(null);
      reportError(error);
    },
  });

  const captureMutation = useMutation({
    mutationFn: (name: string) =>
      budgetApi.captureBaseline({ projectId: projectId as string, name, capturedBy: user?.user_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budget-baselines", projectId] });
      setNotice({
        kind: "success",
        text: "Baseline captured. It doesn't gate anything until it's approved.",
      });
    },
    onError: reportError,
  });

  const approveBaselineMutation = useMutation({
    mutationFn: (baselineId: number) => budgetApi.approveBaseline(baselineId, user?.user_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budget-baselines", projectId] });
      queryClient.invalidateQueries({ queryKey: ["budget-status", projectId] });
      setNotice({ kind: "info", text: "Baseline approved. Estimate changes now go through approval." });
    },
    onError: reportError,
  });

  const resolveMutation = useMutation({
    mutationFn: (vars: { id: number; decision: "approved" | "rejected" }) =>
      budgetApi.resolveChangeRequest(vars.id, vars.decision, user?.user_id),
    onSuccess: (_result, vars) => {
      refreshBudget();
      setNotice({
        kind: vars.decision === "approved" ? "success" : "info",
        text: vars.decision === "approved" ? "Change approved and applied." : "Change rejected.",
      });
    },
    onError: reportError,
  });

  const classifyMutation = useMutation({
    mutationFn: (vars: { wbsId: string; planningElementType: PlanningElementType }) =>
      budgetApi.setPlanningElementType(vars.wbsId, vars.planningElementType),
    onSuccess: () => {
      setClassifying(null);
      queryClient.invalidateQueries({ queryKey: ["wbs", projectId] });
      queryClient.invalidateQueries({ queryKey: ["budget-estimates", projectId] });
      // Classifying an element as a control account is the one action that can
      // make the rollup produce rows where it previously produced none, so it
      // must refresh both it and the control-account list the banner reads.
      queryClient.invalidateQueries({ queryKey: ["budget-periods", projectId] });
      queryClient.invalidateQueries({ queryKey: ["control-accounts", projectId] });
      setNotice({ kind: "success", text: "Classification updated." });
    },
    onError: (error) => {
      setClassifying(null);
      reportError(error);
    },
  });

  const isSaving =
    changeMutation.isPending ||
    captureMutation.isPending ||
    approveBaselineMutation.isPending ||
    resolveMutation.isPending ||
    classifyMutation.isPending;

  // --- Render ----------------------------------------------------------------

  if (!projectId) return <p className="text-sm text-neutral-500">No project selected.</p>;

  if (wbsQuery.isLoading || estimatesQuery.isLoading) {
    return <div className="p-6 text-sm text-neutral-500">Loading the budget…</div>;
  }

  if (wbsQuery.isError || estimatesQuery.isError) {
    return (
      <div className="rounded border border-status-error/30 bg-status-error/5 p-4 text-sm text-status-error">
        Couldn't load the budget for this project.
      </div>
    );
  }

  const described = describeTotal(total, currencyCode);

  function toggle(wbsId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(wbsId)) next.delete(wbsId);
      else next.add(wbsId);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-800">Cost</h1>
          <p className="text-sm text-neutral-500">
            The budget is the sum of every estimate on the WBS. Nothing here is typed in as a total.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Project budget
          </div>
          <div className="text-2xl font-semibold text-neutral-800">{described.text}</div>
          {described.caveat && (
            <div className="max-w-xs text-xs text-status-warning">{described.caveat}</div>
          )}
        </div>
      </header>

      {readOnly && (
        <p className="rounded bg-neutral-100 px-3 py-2 text-sm text-neutral-600">
          {readOnlyReason(user?.role_name, "Cost")}
        </p>
      )}

      {notice && (
        <div
          className={
            "flex items-start justify-between gap-3 rounded px-3 py-2 text-sm " +
            (notice.kind === "error"
              ? "border border-status-error/30 bg-status-error/5 text-status-error"
              : notice.kind === "success"
                ? "border border-status-success/30 bg-status-success/5 text-neutral-700"
                : "border border-neutral-200 bg-neutral-50 text-neutral-700")
          }
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      <Tabs
        tabs={[
          { key: "tree", label: "Budget by WBS" },
          { key: "phased", label: "Time-phased" },
          { key: "baseline", label: "Baseline & changes" },
        ]}
        activeKey={tab}
        onChange={setTab}
      />

      {tab === "tree" && (
        <div className="flex flex-col gap-4 xl:flex-row">
          <div className="min-w-0 flex-1 overflow-x-auto rounded bg-white shadow-elevation-1">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-3 py-2 font-medium">WBS element</th>
                  <th className="px-3 py-2 font-medium">Classification</th>
                  <th className="px-3 py-2 text-right font-medium">Own estimates</th>
                  <th className="px-3 py-2 text-right font-medium">Including below</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const element = row.element;
                  const direct = rollup.direct.get(element.wbs_id) ?? EMPTY_TOTAL;
                  const sub = rollup.subtree.get(element.wbs_id) ?? EMPTY_TOTAL;
                  const directText = describeTotal(direct, currencyCode);
                  const subText = describeTotal(sub, currencyCode);
                  const classification = budgetApi.PLANNING_ELEMENT_TYPES.find(
                    (t) => t.value === element.planning_element_type
                  );
                  const isSelected = selectedWbsId === element.wbs_id;
                  return (
                    <tr
                      key={element.wbs_id}
                      onClick={() => setSelectedWbsId(element.wbs_id)}
                      className={
                        "cursor-pointer border-b border-neutral-100 hover:bg-neutral-50 " +
                        (isSelected ? "bg-brand-primary/5" : "")
                      }
                    >
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1" style={{ paddingLeft: row.depth * 16 }}>
                          {parentIds.has(element.wbs_id) ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggle(element.wbs_id);
                              }}
                              className="rounded p-0.5 text-neutral-400 hover:bg-neutral-200"
                              aria-label={row.isExpanded ? "Collapse" : "Expand"}
                            >
                              {row.isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          ) : (
                            <span className="w-[22px]" />
                          )}
                          <span className="font-mono text-xs text-neutral-500">{element.code}</span>
                          <span className="text-neutral-800">{element.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-1.5">
                        {classification ? (
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">
                            {classification.label}
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-neutral-700">
                        {directText.text}
                        {directText.caveat && (
                          <AlertTriangle
                            size={12}
                            className="ml-1 inline text-status-warning"
                            aria-label={directText.caveat}
                          />
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums text-neutral-800">
                        {subText.text}
                        {/* The figure people actually read on a summary node is
                            this one, so it carries the same warning the direct
                            column does. Without it a control account whose work
                            packages are mostly unrated shows a confident total. */}
                        {subText.caveat && (
                          <AlertTriangle
                            size={12}
                            className="ml-1 inline text-status-warning"
                            aria-label={subText.caveat}
                          />
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <div className="flex justify-end gap-1">
                          {canClassify && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setClassifying({ wbsId: element.wbs_id, code: element.code, name: element.name });
                              }}
                              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                              aria-label={`Classify ${element.code}`}
                              title="Set planning classification"
                            >
                              <Tag size={14} />
                            </button>
                          )}
                          {canCreateCost && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedWbsId(element.wbs_id);
                                setEstimateForm({ wbsId: element.wbs_id, estimate: null });
                              }}
                              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                              aria-label={`Add an estimate to ${element.code}`}
                              title="Add estimate"
                            >
                              <Plus size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="p-4 text-sm text-neutral-500">
                This project has no WBS yet. Build one first — estimates attach to WBS elements, so
                there is nowhere for a budget to live until it exists.
              </p>
            )}
          </div>

          {selected && (
            <aside className="rounded bg-white shadow-elevation-1 xl:w-[400px] xl:shrink-0">
              <div className="flex items-start justify-between gap-2 border-b border-neutral-200 px-4 py-3">
                <div className="min-w-0">
                  <div className="font-mono text-xs text-neutral-500">{selected.code}</div>
                  <h2 className="truncate text-base font-semibold text-neutral-800">{selected.name}</h2>
                </div>
                <button
                  onClick={() => setSelectedWbsId(null)}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100"
                  aria-label="Close panel"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex flex-col gap-3 px-4 py-4">
                {selectedEstimates.length === 0 ? (
                  <p className="text-sm text-neutral-400">
                    No estimates on this element. Anything shown against it in the tree comes from the
                    elements beneath it.
                  </p>
                ) : (
                  <ul className="divide-y divide-neutral-100">
                    {selectedEstimates.map((estimate) => {
                      const value = estimateValue(estimate);
                      return (
                        <li key={estimate.estimate_id} className="flex items-start justify-between gap-2 py-2">
                          <div className="min-w-0">
                            <div className="text-sm text-neutral-800">
                              {String(estimate.base_value)} {estimate.base_unit}
                              {estimate.rate !== null ? ` × ${String(estimate.rate)}` : ""}
                            </div>
                            <div className="text-xs text-neutral-500">
                              {estimate.rate_source || "no note on the rate's source"}
                              {estimate.period_number !== null
                                ? ` · P${estimate.period_number}`
                                : " · not time-phased"}
                            </div>
                            <div
                              className={
                                "text-xs " + (value === null ? "text-status-warning" : "text-neutral-600")
                              }
                            >
                              {value === null
                                ? "No rate — contributes nothing to the budget"
                                : formatMoney(value, currencyCode)}
                            </div>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            {canUpdateCost && (
                              <button
                                onClick={() => setEstimateForm({ wbsId: selected.wbs_id, estimate })}
                                className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                                aria-label="Edit estimate"
                              >
                                <Pencil size={13} />
                              </button>
                            )}
                            {canDeleteCost && (
                              <button
                                onClick={() => setPendingDelete(estimate)}
                                className="rounded p-1 text-neutral-400 hover:bg-status-error/10 hover:text-status-error"
                                aria-label="Remove estimate"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {canCreateCost && (
                  <button
                    onClick={() => setEstimateForm({ wbsId: selected.wbs_id, estimate: null })}
                    className="flex w-fit items-center gap-1.5 rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
                  >
                    <Plus size={14} /> Add estimate
                  </button>
                )}
              </div>
            </aside>
          )}
        </div>
      )}

      {tab === "phased" && (
        <div className="flex flex-col gap-3">
          {!rollupHasRows && !budgetPeriodsQuery.isLoading && (
            <p className="flex items-start gap-2 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
              <Info size={15} className="mt-0.5 shrink-0 text-neutral-400" />
              <span>
                <strong className="font-medium">The formal budget-period rollup is empty.</strong>{" "}
                {diagnosisReady && phasing.reason
                  ? phasing.reason
                  : "Estimates need a fiscal period and a control account above them to appear in it."}{" "}
                The table below is computed from the estimates directly, so it still shows what is
                planned in each period — it just isn't the control-account rollup EIA-748 asks for.
              </span>
            </p>
          )}
          <div className="overflow-x-auto rounded bg-white shadow-elevation-1">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-3 py-2 font-medium">Period</th>
                  <th className="px-3 py-2 text-right font-medium">Budget</th>
                  <th className="px-3 py-2 text-right font-medium">Estimates</th>
                </tr>
              </thead>
              <tbody>
                {periodColumns.map((column) => {
                  const text = describeTotal(column.total, currencyCode);
                  return (
                    <tr key={column.fiscalPeriodId ?? "none"} className="border-b border-neutral-100">
                      <td className="px-3 py-1.5 text-neutral-800">{column.label}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-neutral-800">
                        {text.text}
                        {text.caveat && (
                          <AlertTriangle
                            size={12}
                            className="ml-1 inline text-status-warning"
                            aria-label={text.caveat}
                          />
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-neutral-500">
                        {column.total.estimateCount}
                      </td>
                    </tr>
                  );
                })}
                {periodColumns.length > 0 && (
                  <tr className="bg-neutral-50 font-medium">
                    <td className="px-3 py-1.5 text-neutral-800">Total</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-neutral-800">
                      {described.text}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-neutral-500">
                      {total.estimateCount}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {periodColumns.length === 0 && (
              <p className="p-4 text-sm text-neutral-500">Nothing estimated yet.</p>
            )}
          </div>
          {!calendarId && (
            <p className="text-xs text-neutral-500">
              This project has no calendar assigned, so no fiscal periods are available to tag
              estimates with. Assign one in project settings.
            </p>
          )}

          {/* The formal rollup, shown separately rather than merged into the
              table above. It is deliberately a narrower figure: it counts only
              estimates whose nearest control-account ancestor has a control
              account record, so it can legitimately be smaller than the total.
              Merging the two would produce one number that is neither. */}
          {rollupHasRows && (
            <section className="rounded bg-white p-4 shadow-elevation-1">
              <h2 className="text-sm font-semibold text-neutral-800">
                Control account rollup (EIA-748)
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                The formal budget-period figures, computed by the server per control account. It is
                narrower than the total above for two separate reasons: it counts only estimates
                sitting beneath a control account, and only those tagged to a fiscal period. Both
                exclusions were confirmed against the database rather than assumed.
              </p>
              <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                      <th className="py-1.5 font-medium">Control account</th>
                      <th className="py-1.5 font-medium">Period</th>
                      <th className="py-1.5 text-right font-medium">Budgeted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {controlAccountRollup.map((row) => (
                      <tr key={`${row.control_account_wbs_id}-${row.fiscal_period_id}`} className="border-b border-neutral-100">
                        <td className="py-1.5 text-neutral-800">{row.label}</td>
                        <td className="py-1.5 text-neutral-600">{row.periodLabel}</td>
                        <td className="py-1.5 text-right tabular-nums text-neutral-800">
                          {formatMoney(Number(row.budgeted_amount), currencyCode)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
              </table>
            </section>
          )}
        </div>
      )}

      {tab === "baseline" && (
        <BaselinePanel
          status={statusQuery.data}
          baselines={baselinesQuery.data ?? []}
          changeRequests={changeRequestsQuery.data ?? []}
          currentUserId={user?.user_id ?? null}
          captureWouldBeEmpty={!rollupHasRows && !budgetPeriodsQuery.isLoading}
          canCapture={canCreateCost}
          canApprove={canUpdateCost}
          isSaving={isSaving}
          onCapture={(name) => captureMutation.mutate(name)}
          onApproveBaseline={(id) => approveBaselineMutation.mutate(id)}
          onResolve={(id, decision) => resolveMutation.mutate({ id, decision })}
        />
      )}

      {estimateForm && (
        <EstimateFormModal
          estimate={estimateForm.estimate}
          wbsCode={elements.find((e) => e.wbs_id === estimateForm.wbsId)?.code ?? ""}
          wbsName={elements.find((e) => e.wbs_id === estimateForm.wbsId)?.name ?? ""}
          planningElementType={
            elements.find((e) => e.wbs_id === estimateForm.wbsId)?.planning_element_type ?? null
          }
          hasControlAccountAncestor={underAControlAccount.has(estimateForm.wbsId)}
          periods={periods}
          currencyCode={currencyCode}
          isBaselined={isBaselined}
          isSaving={changeMutation.isPending}
          onClose={() => setEstimateForm(null)}
          onSubmit={(change, description) => {
            // The form doesn't know which element it's for; the page does. An
            // "add" carries a placeholder wbsId that is filled in here rather
            // than threading the id through the form's own state.
            const withTarget =
              change.action === "add" ? { ...change, wbsId: estimateForm.wbsId } : change;
            changeMutation.mutate({ change: withTarget, description });
          }}
        />
      )}

      {pendingDelete && (
        <Modal open onClose={() => setPendingDelete(null)} title="Remove this estimate?">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-neutral-700">
              {String(pendingDelete.base_value)} {pendingDelete.base_unit} on {pendingDelete.wbs_code}{" "}
              will be removed, and the budget will drop by{" "}
              {formatMoney(estimateValue(pendingDelete) ?? 0, currencyCode)}.
            </p>
            {isBaselined && (
              <p className="text-sm text-neutral-600">
                This project has an approved baseline, so the removal becomes a change request rather
                than taking effect now.
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() =>
                  changeMutation.mutate({
                    change: { action: "remove", estimateId: pendingDelete.estimate_id },
                    description: `Remove estimate on ${pendingDelete.wbs_code}`,
                  })
                }
                disabled={isSaving}
                className="rounded bg-status-error px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Remove
              </button>
              <button
                onClick={() => setPendingDelete(null)}
                className="rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {classifying && (
        <ClassifyModal
          code={classifying.code}
          name={classifying.name}
          current={
            elements.find((e) => e.wbs_id === classifying.wbsId)?.planning_element_type ?? null
          }
          isSaving={classifyMutation.isPending}
          onClose={() => setClassifying(null)}
          onSubmit={(planningElementType) =>
            classifyMutation.mutate({ wbsId: classifying.wbsId, planningElementType })
          }
        />
      )}
    </div>
  );
}

// 12.1.1.2.2 — the EIA-748 planning classification. Set here rather than on the
// WBS screen because it is a cost-management decision in practice: it is what
// determines where budget rolls up to, and the person doing it is looking at
// the money.
function ClassifyModal({
  code, name, current, isSaving, onClose, onSubmit,
}: {
  code: string;
  name: string;
  current: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (type: PlanningElementType) => void;
}): JSX.Element {
  const [value, setValue] = useState<string>(current ?? "");
  const chosen = budgetApi.PLANNING_ELEMENT_TYPES.find((t) => t.value === value);

  return (
    <Modal open onClose={onClose} title={`Classify ${code} ${name}`}>
      <div className="flex flex-col gap-4">
        <Select
          label="Planning classification"
          placeholder="— not a planning element —"
          options={budgetApi.PLANNING_ELEMENT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          helperText={chosen?.hint}
        />
        <p className="text-xs text-neutral-500">
          A control account also needs a record linking it to a responsible organization before the
          time-phased budget can roll up to it. That link is made on the Responsibility Assignment
          Matrix, which does not have a screen yet — so classifying alone will not fill the
          time-phased view.
        </p>
        <p className="text-xs text-neutral-500">
          Clearing the classification is not offered here: the endpoint requires a value, and an
          element that has been classified cannot be returned to unclassified through the API.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => value && onSubmit(value as PlanningElementType)}
            disabled={isSaving || value === "" || value === current}
            className="rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save classification"}
          </button>
          <button
            onClick={onClose}
            className="rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
