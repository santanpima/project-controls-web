import { forwardRef, InputHTMLAttributes, useId } from "react";

// 4.2.2.1.1 — consistent prop API across every form component: label,
// error, helperText, required, disabled, and a controlled value/onChange.
// Accessibility baseline (label association, aria-invalid, aria-describedby)
// is treated as a standard for an enterprise application, not an add-on.
interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  error?: string;
  helperText?: string;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ label, error, helperText, required, disabled, id, className, ...rest }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const helperId = `${inputId}-helper`;

    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-base font-medium text-neutral-800">
          {label}
          {required && <span className="text-status-error ml-0.5">*</span>}
        </label>
        <input
          ref={ref}
          id={inputId}
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
TextInput.displayName = "TextInput";
