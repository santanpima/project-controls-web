import { forwardRef, SelectHTMLAttributes, useId } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

// 4.2.2.1.1 — dropdown selection, same prop API as TextInput/TextArea.
// `placeholder` renders as an empty-valued first option, which is how an
// optional enum column (a WBS element with no category set, say) is
// represented honestly: an empty string that the caller converts back to
// null, rather than defaulting the person into a value they never chose.
interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  label: string;
  options: SelectOption[];
  placeholder?: string;
  error?: string;
  helperText?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, options, placeholder, error, helperText, required, disabled, id, className, ...rest }, ref) => {
    const generatedId = useId();
    const selectId = id ?? generatedId;
    const helperId = `${selectId}-helper`;

    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={selectId} className="text-base font-medium text-neutral-800">
          {label}
          {required && <span className="text-status-error ml-0.5">*</span>}
        </label>
        <select
          ref={ref}
          id={selectId}
          required={required}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error || helperText ? helperId : undefined}
          className={
            "rounded border px-3 py-2 text-sm text-neutral-900 " +
            "focus:outline-none focus:ring-2 focus:ring-brand-accent " +
            (error ? "border-status-error" : "border-neutral-300") +
            (disabled ? " bg-neutral-100 text-neutral-400" : " bg-white") +
            (className ? ` ${className}` : "")
          }
          {...rest}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {(error || helperText) && (
          <span id={helperId} className={"text-xs " + (error ? "text-status-error" : "text-neutral-500")}>
            {error || helperText}
          </span>
        )}
      </div>
    );
  }
);
Select.displayName = "Select";
