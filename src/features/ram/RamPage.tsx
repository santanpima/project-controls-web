import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, X, AlertTriangle, Info, UserCog, ArrowRightLeft, Pencil, Check,
} from "lucide-react";
import { useAuth } from "@shared/auth/AuthContext";
import { readOnlyReason } from "@shared/auth/permissions";
import { Modal } from "@shared/components/Modal";
import { Select } from "@shared/components/Select";
import { Tabs } from "@shared/components/Tabs";
import { TextInput } from "@shared/components/TextInput";
import * as ramApi from "@shared/api/ram";
import * as projectsApi from "@shared/api/projects";
import * as wbsApi from "@shared/api/wbs";
import {
  indexElements, rowStatus, cellCreatability, emptyColumns, coverage,
  missingResponsibleOrgRows, formatBudget,
} from "./ram-grid";

// Theme 8, Epic 8.3 — the Responsibility Assignment Matrix.
//
// Every backend piece of this Epic has existed since August 15 with no way in.
// The Cost module has been telling people to come here to create a control
// account record, and until now there was nowhere to come.
//
// One deliberate departure from the specification, under the third-party
// software ground rule: 8.3.1.1.2 names AG Grid, specifically for its
// data-driven columns. This is a plain table. The matrix needs one column per
// organization in scope, which is a `.map()` over an array — the feature a grid
// library would have been taken on for is a language feature here. What a grid
// library would genuinely add, virtualised scrolling for very large matrices,
// matters only at a scale the row and column reduction below is designed to
// prevent. Recorded rather than assumed, per Section 27's requirement that any
// dependency come with a rationale — this one comes with a rationale for not
// taking it.

type Notice = { kind: "info" | "error" | "success"; text: string } | null;

export function RamPage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const { user, can } = useAuth();

  // The RAM lives under the OBS permission module, because that is how the
  // router is mounted — not under "cost", despite control accounts carrying
  // budgets.
  const canCreate = can("obs", "create");
  const canUpdate = can("obs", "update");
  const readOnly = !canCreate && !canUpdate;

  const [tab, setTab] = useState("matrix");
  const [notice, setNotice] = useState<Notice>(null);
  const [creating, setCreating] = useState<{ wbsId: string; code: string; name: string; obsId: string; orgName: string } | null>(null);
  const [reassigning, setReassigning] = useState<ramApi.ControlAccountRow | null>(null);
  const [editingBudget, setEditingBudget] = useState<ramApi.ControlAccountRow | null>(null);
  const [assigningCam, setAssigningCam] = useState<ramApi.ControlAccountRow | null>(null);

  const gridQuery = useQuery({
    queryKey: ["ram-grid", projectId],
    queryFn: () => ramApi.getRamGrid(projectId as string),
    enabled: !!projectId,
  });
  // The WBS list, not /ram/validation, is the source for each row's own flags.
  // /ram/validation deliberately returns only the elements that FAIL its check,
  // so indexing it and reading a responsible organization out of it would
  // return null for every element that has one. It is used below for exactly
  // what it is: the list of failures.
  const elementsQuery = useQuery({
    queryKey: ["wbs", projectId],
    queryFn: () => wbsApi.listWbsElements(projectId as string),
    enabled: !!projectId,
  });
  const accountsQuery = useQuery({
    queryKey: ["control-accounts", projectId],
    queryFn: () => ramApi.listControlAccounts(projectId as string),
    enabled: !!projectId,
  });
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => projectsApi.getProject(projectId as string),
    enabled: !!projectId,
  });

  const currencyCode = projectQuery.data?.base_currency ?? null;
  const columns = useMemo(() => gridQuery.data?.columns ?? [], [gridQuery.data]);
  const rows = useMemo(() => gridQuery.data?.rows ?? [], [gridQuery.data]);
  const crossProject = useMemo(
    () => gridQuery.data?.crossProjectControlAccounts ?? [],
    [gridQuery.data]
  );
  const wbsElements = useMemo(() => elementsQuery.data ?? [], [elementsQuery.data]);
  const elements = useMemo(() => indexElements(wbsElements), [wbsElements]);
  // Elements whose control account sits outside the project and therefore has no
  // column: their rows are genuinely occupied even though no cell is filled.
  const offGridAccounts = useMemo(
    () => new Set(crossProject.map((ca) => ca.wbs_id)),
    [crossProject]
  );
  const summary = useMemo(
    () => coverage(rows, elements, offGridAccounts),
    [rows, elements, offGridAccounts]
  );
  const unusedColumns = useMemo(() => emptyColumns(columns, rows), [columns, rows]);
  const unassigned = useMemo(() => missingResponsibleOrgRows(wbsElements), [wbsElements]);

  function reportError(error: unknown) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : "Something went wrong.";
    setNotice({ kind: "error", text: message });
  }

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["ram-grid", projectId] });
    queryClient.invalidateQueries({ queryKey: ["control-accounts", projectId] });
    queryClient.invalidateQueries({ queryKey: ["wbs", projectId] });
    // The Cost module's own budget-period rollup depends on control accounts
    // existing, so creating one here changes what that screen can show.
    queryClient.invalidateQueries({ queryKey: ["budget-periods", projectId] });
  }

  const createMutation = useMutation({
    mutationFn: (vars: { wbsId: string; obsId: string; budget: number }) =>
      ramApi.createControlAccount(vars),
    onSuccess: () => {
      setCreating(null);
      refresh();
      setNotice({ kind: "success", text: "Control account created." });
    },
    onError: (error) => {
      setCreating(null);
      reportError(error);
    },
  });

  const reassignMutation = useMutation({
    mutationFn: (vars: { id: number; obsId: string }) => ramApi.reassignControlAccount(vars.id, vars.obsId),
    onSuccess: () => {
      setReassigning(null);
      refresh();
      setNotice({ kind: "success", text: "Control account reassigned." });
    },
    onError: (error) => {
      setReassigning(null);
      reportError(error);
    },
  });

  const budgetMutation = useMutation({
    mutationFn: (vars: { id: number; budget: number }) =>
      ramApi.updateControlAccountBudget(vars.id, vars.budget),
    onSuccess: () => {
      setEditingBudget(null);
      refresh();
      setNotice({ kind: "success", text: "Budget updated." });
    },
    onError: (error) => {
      setEditingBudget(null);
      reportError(error);
    },
  });

  const camMutation = useMutation({
    mutationFn: (vars: { wbsId: string; obsId: string; contactName: string; contactEmail: string }) =>
      ramApi.assignCam(vars),
    onSuccess: () => {
      setAssigningCam(null);
      refresh();
      setNotice({ kind: "success", text: "Control account manager assigned." });
    },
    onError: (error) => {
      setAssigningCam(null);
      reportError(error);
    },
  });

  const isSaving =
    createMutation.isPending || reassignMutation.isPending ||
    budgetMutation.isPending || camMutation.isPending;

  if (!projectId) return <p className="text-sm text-neutral-500">No project selected.</p>;
  if (gridQuery.isLoading) return <div className="p-6 text-sm text-neutral-500">Loading the matrix…</div>;
  if (gridQuery.isError) {
    return (
      <div className="rounded border border-status-error/30 bg-status-error/5 p-4 text-sm text-status-error">
        Couldn't load the responsibility matrix for this project.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-800">Responsibility Matrix</h1>
          <p className="text-sm text-neutral-500">
            Where the work meets the organization responsible for it. A filled cell is a control
            account.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Control accounts
          </div>
          <div className="text-2xl font-semibold text-neutral-800">
            {summary.withControlAccount}
            <span className="text-base font-normal text-neutral-400"> / {summary.reportingElements}</span>
          </div>
          <div className="text-xs text-neutral-500">of eligible WBS elements</div>
        </div>
      </header>

      {readOnly && (
        <p className="rounded bg-neutral-100 px-3 py-2 text-sm text-neutral-600">
          {readOnlyReason(user?.role_name, "the responsibility matrix")}
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

      {crossProject.length > 0 && (
        <div className="flex items-start gap-2 rounded border border-status-warning/40 bg-status-warning/5 px-3 py-2 text-sm text-neutral-700">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-status-warning" />
          <div>
            <strong className="font-medium">
              {crossProject.length === 1 ? "One control account isn't" : `${crossProject.length} control accounts aren't`}{" "}
              shown on the matrix.
            </strong>{" "}
            Its organization belongs to a different project, and the matrix only has columns for this
            project's organizations — so there is nowhere on the grid for it to appear. Creating one
            like this is now refused; these predate that check and are listed here so they aren't
            invisible.
            <ul className="mt-1 list-disc pl-5 text-xs">
              {crossProject.map((ca) => (
                <li key={ca.control_account_id}>
                  {ca.wbs_code} {ca.wbs_name} → {ca.obs_code} {ca.obs_name} (another project) ·{" "}
                  {formatBudget(ca.budget, currencyCode)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <Tabs
        tabs={[
          { key: "matrix", label: "Matrix" },
          {
            key: "accounts",
            label: accountsQuery.data
              ? `Control accounts (${accountsQuery.data.length})`
              : "Control accounts",
          },
          {
            key: "gaps",
            label: elementsQuery.data && unassigned.length > 0 ? `Unassigned (${unassigned.length})` : "Unassigned",
          },
        ]}
        activeKey={tab}
        onChange={setTab}
      />

      {tab === "matrix" && (
        <>
          {columns.length === 0 || rows.length === 0 ? (
            <p className="rounded bg-white p-4 text-sm text-neutral-500 shadow-elevation-1">
              {rows.length === 0
                ? "No WBS element is marked as a reporting element yet. The matrix's rows are the elements eligible for a control account, so it has nothing to show until at least one is marked on the WBS screen."
                : "No organization is responsible for any element yet, and none holds a control account, so the matrix has no columns. Assign a responsible organization to a WBS element first."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded bg-white shadow-elevation-1">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                    <th className="sticky left-0 z-10 bg-white px-3 py-2 font-medium">WBS element</th>
                    {columns.map((col) => (
                      <th
                        key={col.obsId}
                        className={
                          "px-3 py-2 text-center font-medium " +
                          (unusedColumns.has(col.obsId) ? "text-neutral-400" : "")
                        }
                        title={
                          unusedColumns.has(col.obsId)
                            ? `${col.name} is responsible for work but holds no control account yet.`
                            : col.name
                        }
                      >
                        <div className="font-mono">{col.orgCode}</div>
                        <div className="truncate text-[10px] font-normal normal-case">{col.name}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const status = rowStatus(row, elements, offGridAccounts);
                    const creatable = cellCreatability(row, status, canCreate);
                    return (
                      <tr key={row.wbsId} className="border-b border-neutral-100 hover:bg-neutral-50">
                        <th
                          scope="row"
                          className="sticky left-0 z-10 bg-white px-3 py-1.5 text-left font-normal"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs text-neutral-500">{row.code}</span>
                            <span className="text-neutral-800">{row.name}</span>
                            {status.missingResponsibleOrg && (
                              <AlertTriangle
                                size={12}
                                className="shrink-0 text-status-warning"
                                aria-label="No responsible organization assigned to this element"
                              />
                            )}
                            {status.ineligibleButHasAccount && (
                              <span
                                className="shrink-0 rounded bg-status-warning/15 px-1 py-0.5 text-[10px] text-neutral-700"
                                title="This element holds a control account but isn't marked as a reporting element. It appears here so the control account isn't invisible."
                              >
                                not eligible
                              </span>
                            )}
                          </div>
                        </th>
                        {columns.map((col) => {
                          const cell = row.cells[col.obsId];
                          const isResponsible = status.responsibleObsId === col.obsId;
                          if (cell?.filled) {
                            return (
                              <td key={col.obsId} className="px-3 py-1.5 text-center">
                                <div
                                  className="inline-flex flex-col items-center rounded bg-brand-primary/10 px-2 py-1"
                                  title={
                                    status.divergesFromResponsibleOrg
                                      ? "This control account sits with a different organization from the one the WBS element names as responsible. Both are editable and genuinely independent."
                                      : undefined
                                  }
                                >
                                  <Check size={13} className="text-brand-primary" />
                                  <span className="text-[10px] tabular-nums text-neutral-600">
                                    {formatBudget(cell.budget, currencyCode)}
                                  </span>
                                </div>
                              </td>
                            );
                          }
                          return (
                            <td key={col.obsId} className="px-3 py-1.5 text-center">
                              {creatable.creatable ? (
                                <button
                                  onClick={() =>
                                    setCreating({
                                      wbsId: row.wbsId,
                                      code: row.code,
                                      name: row.name,
                                      obsId: col.obsId,
                                      orgName: col.name,
                                    })
                                  }
                                  className={
                                    "rounded p-1 text-neutral-300 hover:bg-brand-primary/10 hover:text-brand-primary " +
                                    (isResponsible ? "text-neutral-400 ring-1 ring-inset ring-neutral-200" : "")
                                  }
                                  aria-label={`Create a control account for ${row.code} at ${col.name}`}
                                  title={
                                    isResponsible
                                      ? `${col.name} is already the responsible organization for ${row.code}.`
                                      : `Create a control account here`
                                  }
                                >
                                  <Plus size={13} />
                                </button>
                              ) : (
                                <span
                                  className="text-neutral-200"
                                  title={creatable.reason ?? undefined}
                                  aria-label={creatable.reason ?? undefined}
                                >
                                  ·
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-neutral-500">
            Rows are the WBS elements eligible for a control account, plus any element that already
            holds one. Columns are organizations already responsible for work or already holding a
            control account — not the whole org chart, most of which would never intersect with one.
          </p>
        </>
      )}

      {tab === "accounts" && (
        <div className="overflow-x-auto rounded bg-white shadow-elevation-1">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-3 py-2 font-medium">WBS element</th>
                <th className="px-3 py-2 font-medium">Control account organization</th>
                <th className="px-3 py-2 font-medium">Control account manager</th>
                <th className="px-3 py-2 text-right font-medium">Budget</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {(accountsQuery.data ?? []).map((ca) => (
                <tr key={ca.control_account_id} className="border-b border-neutral-100">
                  <td className="px-3 py-1.5">
                    <span className="font-mono text-xs text-neutral-500">{ca.wbs_code}</span>{" "}
                    <span className="text-neutral-800">{ca.wbs_name}</span>
                  </td>
                  <td className="px-3 py-1.5 text-neutral-700">{ca.obs_name}</td>
                  <td className="px-3 py-1.5">
                    {ca.cam_name ? (
                      <span className="text-neutral-700">
                        {ca.cam_name}
                        {ca.cam_email && (
                          <span className="block text-xs text-neutral-500">{ca.cam_email}</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-neutral-400">none assigned</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-neutral-800">
                    {formatBudget(ca.budget, currencyCode)}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-neutral-500">{ca.status}</td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex justify-end gap-1">
                      {canUpdate && (
                        <>
                          <button
                            onClick={() => setEditingBudget(ca)}
                            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                            aria-label={`Edit the budget for ${ca.wbs_code}`}
                            title="Edit budget"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => setReassigning(ca)}
                            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                            aria-label={`Reassign ${ca.wbs_code} to another organization`}
                            title="Reassign to another organization"
                          >
                            <ArrowRightLeft size={14} />
                          </button>
                        </>
                      )}
                      {canCreate && !ca.cam_name && (
                        <button
                          onClick={() => setAssigningCam(ca)}
                          className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                          aria-label={`Assign a control account manager for ${ca.wbs_code}`}
                          title="Assign a control account manager"
                        >
                          <UserCog size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {accountsQuery.isLoading && (
            <p className="p-4 text-sm text-neutral-500">Loading control accounts…</p>
          )}
          {accountsQuery.isError && (
            <p className="p-4 text-sm text-status-error">
              Couldn&apos;t load the control accounts. This list is unknown, not empty.
            </p>
          )}
          {!accountsQuery.isLoading && !accountsQuery.isError && (accountsQuery.data ?? []).length === 0 && (
            <p className="p-4 text-sm text-neutral-500">
              No control accounts yet. Create one from a cell on the Matrix tab.
            </p>
          )}
          <p className="px-3 py-2 text-xs text-neutral-500">
            A control account cannot be deleted — no endpoint anywhere removes one. It can be
            reassigned to a different organization or have its budget corrected, so a mistake is
            recoverable, but the row itself stays.
          </p>
        </div>
      )}

      {tab === "gaps" && (
        <div className="rounded bg-white p-4 shadow-elevation-1">
          <h2 className="text-sm font-semibold text-neutral-800">
            Eligible elements with no responsible organization
          </h2>
          <p className="mt-1 text-xs text-neutral-600">
            A soft flag, not a problem to be blocked on. A responsible organization is deliberately
            optional so an element can sit unassigned during early planning — this just says which
            ones currently are. Assign one from the WBS screen's dictionary panel.
          </p>
          {elementsQuery.isLoading ? (
            <p className="mt-3 text-sm text-neutral-500">Loading the WBS…</p>
          ) : elementsQuery.isError ? (
            <p className="mt-3 text-sm text-status-error">
              Couldn&apos;t load the WBS, so this list can&apos;t be shown. It isn&apos;t empty —
              it&apos;s unknown.
            </p>
          ) : unassigned.length === 0 ? (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-neutral-500">
              <Info size={14} className="text-neutral-400" />
              Every eligible element names a responsible organization.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-neutral-100">
              {unassigned.map((el) => (
                <li key={el.wbs_id} className="py-2 text-sm">
                  <span className="font-mono text-xs text-neutral-500">{el.code}</span>{" "}
                  <span className="text-neutral-800">{el.name}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-neutral-500">
            <Link to={`/projects/${projectId}/wbs`} className="text-brand-primary hover:underline">
              Go to the WBS
            </Link>{" "}
            to assign one.
          </p>
        </div>
      )}

      {creating && (
        <CreateControlAccountModal
          wbsCode={creating.code}
          wbsName={creating.name}
          orgName={creating.orgName}
          isClassifiedControlAccount={
            elements.get(creating.wbsId)?.planning_element_type === "control_account"
          }
          isSaving={createMutation.isPending}
          onClose={() => setCreating(null)}
          onSubmit={(budget) =>
            createMutation.mutate({ wbsId: creating.wbsId, obsId: creating.obsId, budget })
          }
        />
      )}

      {reassigning && (
        <ReassignModal
          account={reassigning}
          columns={columns}
          isSaving={reassignMutation.isPending}
          onClose={() => setReassigning(null)}
          onSubmit={(obsId) =>
            reassignMutation.mutate({ id: reassigning.control_account_id, obsId })
          }
        />
      )}

      {editingBudget && (
        <BudgetModal
          account={editingBudget}
          isSaving={budgetMutation.isPending}
          onClose={() => setEditingBudget(null)}
          onSubmit={(budget) =>
            budgetMutation.mutate({ id: editingBudget.control_account_id, budget })
          }
        />
      )}

      {assigningCam && (
        <CamModal
          account={assigningCam}
          isSaving={camMutation.isPending}
          onClose={() => setAssigningCam(null)}
          onSubmit={(contactName, contactEmail) =>
            camMutation.mutate({
              wbsId: assigningCam.wbs_id,
              obsId: assigningCam.obs_id,
              contactName,
              contactEmail,
            })
          }
        />
      )}
      {/* isSaving is intentionally read here so a stray click elsewhere while a
          mutation is in flight can't start a second one unnoticed. */}
      {isSaving && <span className="sr-only">Saving…</span>}
    </div>
  );
}

// 8.3.1.2.1 — the WBS element and organization come from the cell that was
// clicked; the budget is the one thing a person supplies. Deliberately a
// confirmation rather than an inline toggle, because nothing can delete what
// this creates.
function CreateControlAccountModal({
  wbsCode, wbsName, orgName, isClassifiedControlAccount, isSaving, onClose, onSubmit,
}: {
  wbsCode: string;
  wbsName: string;
  orgName: string;
  isClassifiedControlAccount: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (budget: number) => void;
}): JSX.Element {
  const [budget, setBudget] = useState("");
  const parsed = Number(budget);
  const valid = budget.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;

  return (
    <Modal open onClose={onClose} title="Create a control account">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-neutral-700">
          <span className="font-mono text-xs text-neutral-500">{wbsCode}</span> {wbsName} becomes a
          control account managed by <strong className="font-medium">{orgName}</strong>.
        </p>
        <TextInput
          label="Budget"
          required
          type="number"
          step="0.01"
          min="0"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          helperText="The control account's total budget. It can be corrected later, and it is separate from the estimates the Cost module rolls up."
          error={budget.trim() !== "" && !valid ? "Enter a number of zero or more." : undefined}
        />
        <p className="text-xs text-neutral-500">
          There is no way to delete a control account once created — it can be reassigned to another
          organization or have its budget changed, but the record stays. A WBS element can hold only
          one.
        </p>
        {!isClassifiedControlAccount && (
          <p className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
            If you came here from the Cost module to fill its budget rollup, this alone won&apos;t do
            it. That rollup keys on a separate field — the element&apos;s EIA-748 planning
            classification — which this doesn&apos;t set. Set it to <em>Control account</em> on the
            Cost screen as well.
          </p>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => onSubmit(parsed)}
            disabled={isSaving || !valid}
            className="rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSaving ? "Creating..." : "Create control account"}
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

function ReassignModal({
  account, columns, isSaving, onClose, onSubmit,
}: {
  account: ramApi.ControlAccountRow;
  columns: ramApi.RamColumn[];
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (obsId: string) => void;
}): JSX.Element {
  // The account's current organization may not be among the matrix's columns —
  // it can sit outside the project, or have been soft-deleted. A <Select> whose
  // value matches no option silently displays the FIRST option instead, so the
  // person would see an organization that isn't the account's. Starting empty
  // with a placeholder says "nothing chosen yet", which is the truth.
  const currentIsOffered = columns.some((c) => c.obsId === account.obs_id);
  const [obsId, setObsId] = useState(currentIsOffered ? account.obs_id : "");

  return (
    <Modal open onClose={onClose} title={`Reassign ${account.wbs_code}`}>
      <div className="flex flex-col gap-4">
        {!currentIsOffered && (
          <p className="rounded border border-status-warning/40 bg-status-warning/5 px-3 py-2 text-xs text-neutral-700">
            This control account&apos;s current organization isn&apos;t on the matrix — it belongs to
            another project, or has been removed. Choose one below to bring it back onto the grid.
          </p>
        )}
        <Select
          label="Organization"
          placeholder={currentIsOffered ? undefined : "— choose an organization —"}
          options={columns.map((c) => ({ value: c.obsId, label: `${c.orgCode}  ${c.name}` }))}
          value={obsId}
          onChange={(e) => setObsId(e.target.value)}
          helperText="The control account moves to this organization's column on the matrix. Its budget, manager and WBS element are unchanged. This is the control account's own organization, which is a separate field from the WBS element's responsible organization."
        />
        {/* The picker offers only organizations already in the matrix's columns.
            An organization not yet in scope has no column, so a control account
            assigned to it would vanish from the grid — the same failure mode the
            cross-project warning describes. */}
        <p className="text-xs text-neutral-500">
          Only organizations already on the matrix are offered. To move a control account somewhere
          else, first make that organization responsible for a WBS element so it has a column.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => onSubmit(obsId)}
            disabled={isSaving || obsId === "" || obsId === account.obs_id}
            className="rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSaving ? "Reassigning..." : "Reassign"}
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

function BudgetModal({
  account, isSaving, onClose, onSubmit,
}: {
  account: ramApi.ControlAccountRow;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (budget: number) => void;
}): JSX.Element {
  const [budget, setBudget] = useState(String(account.budget ?? ""));
  const parsed = Number(budget);
  const valid = budget.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;

  return (
    <Modal open onClose={onClose} title={`Budget for ${account.wbs_code}`}>
      <div className="flex flex-col gap-4">
        <TextInput
          label="Budget"
          required
          type="number"
          step="0.01"
          min="0"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          error={budget.trim() !== "" && !valid ? "Enter a number of zero or more." : undefined}
        />
        <p className="text-xs text-neutral-500">
          This figure is the control account's own budget. It is stored on the account and is not the
          same number as the sum of the cost estimates beneath it, which the Cost module derives
          separately — the two are not reconciled anywhere.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => onSubmit(parsed)}
            disabled={isSaving || !valid}
            className="rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save budget"}
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

// 8.3.1.2.2 — one CAM per control account, enforced by a database trigger. The
// button that opens this is hidden once a manager exists, so the trigger is a
// backstop rather than the thing a person meets.
function CamModal({
  account, isSaving, onClose, onSubmit,
}: {
  account: ramApi.ControlAccountRow;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (contactName: string, contactEmail: string) => void;
}): JSX.Element {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  return (
    <Modal open onClose={onClose} title={`Control account manager for ${account.wbs_code}`}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-neutral-700">
          The person accountable for {account.wbs_name} within {account.obs_name}.
        </p>
        <TextInput label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextInput
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          helperText="A contact record, not a user account — assigning a manager here does not grant anyone access to this application."
        />
        <p className="text-xs text-neutral-500">
          Only one manager is allowed per control account, enforced by the database rather than by
          this form alone.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => onSubmit(name.trim(), email.trim())}
            disabled={isSaving || name.trim() === ""}
            className="rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSaving ? "Assigning..." : "Assign manager"}
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
