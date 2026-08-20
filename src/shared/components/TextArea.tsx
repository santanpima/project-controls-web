import { forwardRef, TextareaHTMLAttributes, useId } from "react";

// 4.2.2.1.1 — the same prop API TextInput established (label, error,
// helperText, required, disabled, controlled value/onChange) applied to
// multi-line input. Added when the WBS dictionary panel needed real
// paragraph fields (description, scope, deliverable, exclusions,
// acceptance criteria); deliberately built as a shared component matching
// the existing convention rather than a one-off <textarea> inside that
// screen, since every dictionary-style form after this one needs the same
// thing.
interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  helperText?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ label, error, helperText, required, disabled, id, className, rows = 3, ...rest }, ref) => {
    const generatedId = useId();
    const textAreaId = id ?? generatedId;
    const helperId = `${textAreaId}-helper`;

    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={textAreaId} className="text-base font-medium text-neutral-800">
          {label}
          {required && <span className="text-status-error ml-0.5">*</span>}
        </label>
        <textarea
          ref={ref}
          id={textAreaId}
          rows={rows}
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
        />
        {(error || helperText) && (
          <span id={helperId} className={"text-xs " + (error ? "text-status-error" : "text-neutral-500")}>
            {error || helperText}
          </span>
        )}
      </div>
    );
  }
);
TextArea.displayName = "TextArea";
