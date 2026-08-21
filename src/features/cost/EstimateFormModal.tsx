import { useState } from "react";
import { Modal } from "@shared/components/Modal";
import { TextInput } from "@shared/components/TextInput";
import { Select } from "@shared/components/Select";
import * as budgetApi from "@shared/api/budget";
import type { BaseUnit, Estimate } from "@shared/api/budget";
import type { FiscalPeriod } from "@shared/api/calendars";
import { estimatePlacementWarning, formatMoney, toNumber } from "./budget-rollup";

// 11.4.1.1.1 / 11.4.1.1.3 — entering and revising a cost estimate.
//
// An estimate is a quantity, a unit, a rate, a note about where the rate came
// from, and a fiscal period. What it is *not* is a resource: the backing table
// is called package_resource_estimate but has no resource column, so this form
// deliberately doesn't pretend to link one. The rate-source note is where that
// information actually lives today, which is why it's a first-class field here
// rather than an afterthought.

interface EstimateFormModalProps {
  estimate: Estimate | null; // null = creating
  wbsCode: string;
  wbsName: string;
  planningElementType: string | null;
  hasControlAccountAncestor: boolean;
  periods: FiscalPeriod[];
  currencyCode: string | null;
  isBaselined: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (change: budgetApi.EstimateChange, description: string) => void;
}

export function EstimateFormModal({
  estimate, wbsCode, wbsName, planningElementType, hasControlAccountAncestor, periods, currencyCode,
  isBaselined, isSaving, onClose, onSubmit,
}: EstimateFormModalProps): JSX.Element {
  const [baseValue, setBaseValue] = useState(estimate ? String(estimate.base_value) : "");
  const [baseUnit, setBaseUnit] = useState<BaseUnit>(estimate?.base_unit ?? "hours");
  const [rate, setRate] = useState(estimate?.rate !== null && estimate?.rate !== undefined ? String(estimate.rate) : "");
  const [rateSource, setRateSource] = useState(estimate?.rate_source ?? "");
  const [fiscalPeriodId, setFiscalPeriodId] = useState(estimate?.fiscal_period_id ?? "");
  const [description, setDescription] = useState("");

  const quantity = toNumber(baseValue);
  const rateValue = toNumber(rate);
  const preview = quantity !== null && rateValue !== null ? quantity * rateValue : null;
  const placementWarning = estimatePlacementWarning(planningElementType, hasControlAccountAncestor);
  const canSubmit = quantity !== null && (!isBaselined || description.trim() !== "");

  function submit() {
    if (quantity === null) return;
    if (estimate) {
      onSubmit(
        { action: "update", estimateId: estimate.estimate_id, baseValue: quantity, rate: rateValue },
        description.trim()
      );
      return;
    }
    onSubmit(
      {
        action: "add",
        wbsId: "", // filled in by the caller, which owns the selected element
        baseValue: quantity,
        baseUnit,
        rate: rateValue,
        rateSource: rateSource.trim() || null,
        fiscalPeriodId: fiscalPeriodId || null,
      },
      description.trim()
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={estimate ? `Edit estimate on ${wbsCode}` : `New estimate on ${wbsCode} ${wbsName}`}
    >
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
        {placementWarning && (
          <p className="rounded border border-status-warning/40 bg-status-warning/5 px-3 py-2 text-xs text-neutral-700">
            {placementWarning}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="Quantity"
            required
            type="number"
            step="0.01"
            value={baseValue}
            onChange={(e) => setBaseValue(e.target.value)}
            helperText="How much work or material this is."
          />
          <Select
            label="Unit"
            options={budgetApi.BASE_UNITS.map((u) => ({ value: u.value, label: u.label }))}
            value={baseUnit}
            onChange={(e) => setBaseUnit(e.target.value as BaseUnit)}
            disabled={!!estimate}
            helperText={
              estimate
                ? "The unit is fixed once an estimate exists."
                : budgetApi.BASE_UNITS.find((u) => u.value === baseUnit)?.hint
            }
          />
        </div>

        <TextInput
          label="Rate"
          type="number"
          step="0.0001"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          helperText="Cost per hour or per unit. Leave blank if it isn't known yet — the estimate will be saved and will contribute nothing to the budget until a rate is set."
        />

        {/* The single most important number on this form: what it will actually
            add to the budget. Shown before saving rather than discovered
            afterwards on the tree. */}
        <div className="rounded bg-neutral-50 px-3 py-2">
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Adds to the budget
          </div>
          <div className="text-lg font-semibold text-neutral-800">
            {preview !== null ? formatMoney(preview, currencyCode) : "Nothing yet"}
          </div>
          {preview === null && (
            <p className="text-xs text-neutral-500">
              {quantity === null
                ? "Enter a quantity."
                : "No rate, so this estimate is worth zero in every budget total until one is entered."}
            </p>
          )}
        </div>

        {!estimate && (
          <>
            <TextInput
              label="Where the rate came from"
              value={rateSource}
              onChange={(e) => setRateSource(e.target.value)}
              helperText="Free text — a labor category, a quote, a resource name. An estimate has no resource field, so this note is the only record of what it represents."
            />
            <Select
              label="Fiscal period"
              placeholder="— not time-phased —"
              options={periods.map((p) => ({
                value: p.fiscal_period_id,
                label: `P${p.period_number}  ${p.start_date.slice(0, 10)} → ${p.end_date.slice(0, 10)}`,
              }))}
              value={fiscalPeriodId}
              onChange={(e) => setFiscalPeriodId(e.target.value)}
              helperText="Which period this money is planned for. An estimate with no period still counts toward the total but never appears in the time-phased budget."
            />
          </>
        )}

        {estimate && (
          <p className="text-xs text-neutral-500">
            The unit, rate source and fiscal period are set when an estimate is created and are not
            editable here — the backend's change model covers quantity and rate only. Remove and
            re-add the estimate to change the rest.
          </p>
        )}

        {isBaselined && (
          <TextInput
            label="Reason for the change"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            helperText="This project has an approved baseline, so this won't apply straight away — it becomes a change request for someone else to approve."
          />
        )}

        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={isSaving || !canSubmit}
            className="rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSaving ? "Saving..." : isBaselined ? "Submit for approval" : estimate ? "Save changes" : "Add estimate"}
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
