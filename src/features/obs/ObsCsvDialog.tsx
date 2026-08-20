import { useState } from "react";
import { Upload, AlertTriangle } from "lucide-react";
import { Modal } from "@shared/components/Modal";
import { TextArea } from "@shared/components/TextArea";
import type { ImportFailure } from "@shared/api/obs";

// 8.1.1.2.2 — the import half of bulk CSV import/export.
//
// The validation that matters already exists server-side and is genuinely
// all-or-nothing: duplicate codes, unknown types, parent references that
// resolve to nothing, and circular org charts are all caught before a single
// row is written. This dialog's real job is to show those per-line messages
// clearly instead of collapsing them into one "import failed", because they
// are exactly what a person needs to fix the file.

interface ObsCsvDialogProps {
  open: boolean;
  isImporting: boolean;
  failure: ImportFailure | null;
  onClose: () => void;
  onImport: (csv: string) => void;
}

const TEMPLATE = "org_code,name,type,parent_org_code";

export function ObsCsvDialog({ open, isImporting, failure, onClose, onImport }: ObsCsvDialogProps): JSX.Element {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);

  // Reading the file in the browser and posting its text keeps this on the
  // same JSON endpoint everything else uses — no multipart upload path has to
  // exist on the backend just for this one screen.
  function handleFile(event: { target: { files: FileList | null } }) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  return (
    <Modal open={open} onClose={onClose} title="Import organizations from CSV">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-neutral-600">
          The file needs a header row. Columns: <code className="text-xs">{TEMPLATE}</code>. Type must be one
          of internal, subcontractor, vendor, government_customer, and may be left blank.{" "}
          <span className="text-neutral-500">
            Nothing is saved unless every row passes validation — a file with one bad line imports nothing,
            rather than half an org chart.
          </span>
        </p>

        <label className="flex w-fit cursor-pointer items-center gap-2 rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50">
          <Upload size={14} />
          {fileName ?? "Choose a CSV file"}
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
        </label>

        <TextArea
          label="CSV contents"
          rows={8}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          helperText="Loaded from the file above, or pasted directly."
          className="font-mono text-xs"
        />

        {failure && (
          <div className="rounded border border-status-error/30 bg-status-error/5 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-status-error">
              <AlertTriangle size={16} />
              {failure.error} — nothing was saved.
            </div>
            <ul className="mt-2 list-disc pl-5 text-sm text-status-error">
              {failure.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => onImport(csv)}
            disabled={isImporting || csv.trim() === ""}
            className="rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isImporting ? "Importing..." : "Import organizations"}
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
