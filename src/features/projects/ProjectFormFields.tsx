import { useState } from "react";
import { Plus } from "lucide-react";
import { TextInput } from "@shared/components/TextInput";
import { Select } from "@shared/components/Select";
import * as projectsApi from "@shared/api/projects";
import type { ProjectFolder, ProjectTag } from "@shared/api/projects";

// The attribute fields shared by the create dialog and the settings screen
// (5.1.1.1.3). Kept in one component because the two screens must not drift:
// a field offered at creation and missing from settings would leave a value a
// person can set once and never change.

// The four currencies seeded by Theme 11. Deliberately a fixed list rather
// than a fetch: the currency table is seeded, protected from renaming, and
// four rows long, so a round trip to read it would buy nothing.
export const BASE_CURRENCIES = ["USD", "EUR", "GBP", "JPY"];

export interface ProjectFormValues {
  name: string;
  startDate: string;
  endDate: string;
  baseCurrency: string;
  folderId: string;
  tagNames: string[];
}

export const emptyProjectForm: ProjectFormValues = {
  name: "", startDate: "", endDate: "", baseCurrency: "USD", folderId: "", tagNames: [],
};

interface ProjectFormFieldsProps {
  values: ProjectFormValues;
  onChange: (values: ProjectFormValues) => void;
  folders: ProjectFolder[];
  tags: ProjectTag[];
  onFolderCreated: (folder: ProjectFolder) => void;
  showCurrency?: boolean;
}

export function ProjectFormFields({
  values, onChange, folders, tags, onFolderCreated, showCurrency = true,
}: ProjectFormFieldsProps): JSX.Element {
  const [newFolderName, setNewFolderName] = useState("");
  const [addingFolder, setAddingFolder] = useState(false);
  const [newTag, setNewTag] = useState("");

  const set = (patch: Partial<ProjectFormValues>) => onChange({ ...values, ...patch });

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    const folder = await projectsApi.createFolder(name);
    onFolderCreated(folder);
    set({ folderId: String(folder.folder_id) });
    setNewFolderName("");
    setAddingFolder(false);
  }

  function addTag(name: string) {
    const trimmed = name.trim();
    if (!trimmed || values.tagNames.includes(trimmed)) return;
    set({ tagNames: [...values.tagNames, trimmed] });
    setNewTag("");
  }

  return (
    <>
      <TextInput
        label="Project name"
        required
        value={values.name}
        onChange={(e) => set({ name: e.target.value })}
      />

      <div className="grid grid-cols-2 gap-3">
        <TextInput
          label="Start date"
          type="date"
          value={values.startDate}
          onChange={(e) => set({ startDate: e.target.value })}
        />
        <TextInput
          label="End date"
          type="date"
          value={values.endDate}
          onChange={(e) => set({ endDate: e.target.value })}
        />
      </div>

      {showCurrency && (
        <Select
          label="Base currency"
          options={BASE_CURRENCIES.map((c) => ({ value: c, label: c }))}
          value={values.baseCurrency}
          onChange={(e) => set({ baseCurrency: e.target.value })}
          helperText="Set once at creation — every cost figure on this project reports against it."
        />
      )}

      <div className="flex flex-col gap-1">
        <Select
          label="Folder"
          placeholder="— none —"
          options={folders.map((f) => ({ value: String(f.folder_id), label: f.name }))}
          value={values.folderId}
          onChange={(e) => set({ folderId: e.target.value })}
        />
        {addingFolder ? (
          <div className="flex items-end gap-2">
            <TextInput
              label="New folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              className="flex-1"
            />
            <button
              type="button"
              onClick={createFolder}
              className="rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setAddingFolder(false)}
              className="rounded px-2 py-2 text-sm text-neutral-500 hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingFolder(true)}
            className="flex w-fit items-center gap-1 text-xs text-brand-accent hover:underline"
          >
            <Plus size={12} /> New folder
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-base font-medium text-neutral-800">Tags</span>
        <div className="flex flex-wrap gap-1">
          {values.tagNames.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => set({ tagNames: values.tagNames.filter((t) => t !== tag) })}
              className="rounded bg-brand-accent/10 px-2 py-0.5 text-xs text-brand-accent hover:bg-brand-accent/20"
              title="Remove tag"
            >
              {tag} ×
            </button>
          ))}
          {values.tagNames.length === 0 && <span className="text-xs text-neutral-400">None</span>}
        </div>
        <div className="mt-1 flex items-end gap-2">
          <TextInput
            label="Add a tag"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            // Enter submits the tag rather than the surrounding form, which
            // would otherwise create the project with a half-typed tag lost.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag(newTag);
              }
            }}
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => addTag(newTag)}
            className="rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
          >
            Add
          </button>
        </div>
        {tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            <span className="text-xs text-neutral-500">Existing:</span>
            {tags
              .filter((t) => !values.tagNames.includes(t.name))
              .slice(0, 12)
              .map((tag) => (
                <button
                  key={tag.tag_id}
                  type="button"
                  onClick={() => addTag(tag.name)}
                  className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-200"
                >
                  {tag.name}
                </button>
              ))}
          </div>
        )}
      </div>
    </>
  );
}

// The API takes camelCase and treats empty strings as real values, so blanks
// have to become nulls here rather than being sent through as "".
export function toCreateInput(values: ProjectFormValues): projectsApi.CreateProjectInput {
  return {
    name: values.name.trim(),
    startDate: values.startDate || null,
    endDate: values.endDate || null,
    baseCurrency: values.baseCurrency || "USD",
    folderId: values.folderId === "" ? null : Number(values.folderId),
    tagNames: values.tagNames,
  };
}
