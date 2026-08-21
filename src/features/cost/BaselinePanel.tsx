import { useState } from "react";
import { Check, X, Lock, LockOpen, ShieldCheck } from "lucide-react";
import { TextInput } from "@shared/components/TextInput";
import type { BudgetBaseline, BudgetChangeRequest, BudgetStatus } from "@shared/api/budget";

// 11.4.1.1.2 / 11.4.1.1.3 — the Performance Measurement Baseline and the
// change control that follows it.
//
// The one thing this panel has to communicate correctly, because the word
// "baseline" invites the opposite assumption: capturing a baseline does not
// lock the project. Nothing is prevented. Planning and actual work both carry
// on exactly as before. What changes is only that estimate edits stop applying
// immediately and start requiring a second person's approval. The panel says
// that in those words rather than showing a padlock and leaving it to be
// inferred.

interface BaselinePanelProps {
  status: BudgetStatus | undefined;
  baselines: BudgetBaseline[];
  changeRequests: BudgetChangeRequest[];
  currentUserId: string | null;
  // True when the server-side rollup this baseline would snapshot has no rows.
  captureWouldBeEmpty: boolean;
  canCapture: boolean;
  canApprove: boolean;
  isSaving: boolean;
  onCapture: (name: string) => void;
  onApproveBaseline: (baselineId: number) => void;
  onResolve: (changeRequestId: number, decision: "approved" | "rejected") => void;
}

export function BaselinePanel({
  status, baselines, changeRequests, currentUserId, captureWouldBeEmpty,
  canCapture, canApprove, isSaving, onCapture, onApproveBaseline, onResolve,
}: BaselinePanelProps): JSX.Element {
  const [name, setName] = useState("");

  const pending = changeRequests.filter((cr) => cr.status === "pending");

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded bg-white p-4 shadow-elevation-1">
        <div className="flex items-start gap-2">
          {status?.isBaselined ? (
            <Lock size={16} className="mt-0.5 shrink-0 text-brand-primary" />
          ) : (
            <LockOpen size={16} className="mt-0.5 shrink-0 text-neutral-400" />
          )}
          <div>
            <h2 className="text-sm font-semibold text-neutral-800">
              {status?.isBaselined ? "Estimate changes need approval" : "Estimates edit directly"}
            </h2>
            <p className="mt-1 text-xs text-neutral-600">
              {status?.isBaselined ? (
                <>
                  This project has an approved baseline, so a change to any estimate becomes a request
                  for someone else to approve rather than taking effect straight away. Nothing else is
                  restricted — planning and actual work carry on exactly as before, and the project can
                  be re-baselined at any time.
                </>
              ) : (
                <>
                  No approved baseline yet, so estimates apply the moment they're saved. A project never
                  needs a baseline to function; capturing one is a deliberate choice about when to start
                  measuring against a fixed plan.
                </>
              )}
            </p>
          </div>
        </div>
      </section>

      {pending.length > 0 && (
        <section className="rounded bg-white p-4 shadow-elevation-1">
          <h2 className="text-sm font-semibold text-neutral-800">
            Awaiting approval ({pending.length})
          </h2>
          <ul className="mt-2 divide-y divide-neutral-100">
            {pending.map((cr) => {
              // The backend refuses a decision from the person who requested
              // the change. Showing the buttons anyway would produce an error
              // that reads like a fault rather than a rule.
              const isOwnRequest = !!currentUserId && cr.requested_by === currentUserId;
              return (
                <li key={cr.budget_change_request_id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm text-neutral-800">
                      {cr.proposed_change?.description || "No reason given"}
                    </div>
                    <div className="text-xs text-neutral-500">
                      {String(cr.proposed_change?.action ?? "change")} · requested{" "}
                      {cr.requested_at?.slice(0, 10)}
                    </div>
                  </div>
                  {canApprove &&
                    (isOwnRequest ? (
                      <span className="shrink-0 text-xs text-neutral-500">
                        Yours — someone else approves
                      </span>
                    ) : (
                      <div className="flex shrink-0 gap-1">
                        <button
                          onClick={() => onResolve(cr.budget_change_request_id, "approved")}
                          disabled={isSaving}
                          className="flex items-center gap-1 rounded border border-status-success/40 px-2 py-1 text-xs text-status-success hover:bg-status-success/5 disabled:opacity-50"
                        >
                          <Check size={12} /> Approve
                        </button>
                        <button
                          onClick={() => onResolve(cr.budget_change_request_id, "rejected")}
                          disabled={isSaving}
                          className="flex items-center gap-1 rounded border border-status-error/40 px-2 py-1 text-xs text-status-error hover:bg-status-error/5 disabled:opacity-50"
                        >
                          <X size={12} /> Reject
                        </button>
                      </div>
                    ))}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="rounded bg-white p-4 shadow-elevation-1">
        <h2 className="text-sm font-semibold text-neutral-800">Baselines</h2>
        {baselines.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-400">None captured yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-100">
            {baselines.map((b) => (
              <li key={b.budget_baseline_id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm text-neutral-800">
                    {b.approved_at && <ShieldCheck size={13} className="shrink-0 text-status-success" />}
                    <span className="truncate">{b.name}</span>
                  </div>
                  {/* The list endpoint deliberately omits the snapshot itself —
                      it is a whole JSON document per baseline — so no captured
                      total is shown here rather than a figure that would be
                      wrong or perpetually blank. */}
                  <div className="text-xs text-neutral-500">
                    captured {b.captured_at?.slice(0, 10)} ·{" "}
                    {b.approved_at ? `approved ${b.approved_at.slice(0, 10)}` : "not approved"}
                  </div>
                </div>
                {!b.approved_at && canApprove && (
                  <button
                    onClick={() => onApproveBaseline(b.budget_baseline_id)}
                    disabled={isSaving}
                    className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
                  >
                    Approve
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canCapture && (
          <div className="mt-4 flex flex-col gap-2 border-t border-neutral-200 pt-4">
            <TextInput
              label="New baseline name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              helperText="Captures the control-account rollup exactly as it stands right now, and never changes afterwards even as estimates evolve."
            />
            <button
              onClick={() => {
                onCapture(name.trim());
                setName("");
              }}
              disabled={isSaving || name.trim() === ""}
              className="w-fit rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Capture baseline
            </button>
            <p className="text-xs text-neutral-500">
              A captured baseline is not yet in force. It gates estimate changes only once it's approved.
            </p>
            {/* Said plainly, because the consequence is severe and silent: a
                baseline captured with nothing to capture still gates every
                later change, against an empty snapshot. The snapshot is never
                displayed anywhere, so there is no way to discover this after
                the fact. */}
            {captureWouldBeEmpty && (
              <p className="rounded border border-status-warning/40 bg-status-warning/5 px-3 py-2 text-xs text-neutral-700">
                There is nothing to capture yet — the control-account rollup is empty, so this would
                record a baseline containing no figures. Once approved it would still require approval
                for every estimate change, measured against nothing. Worth fixing the rollup first;
                the Time-phased tab says what it needs.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
