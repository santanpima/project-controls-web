import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate, Link } from "react-router-dom";
import { useState } from "react";
import { useAuth, ApiError } from "@shared/auth/AuthContext";
import { TextInput } from "@shared/components/TextInput";

// Mirrors password-policy.js's validatePassword() exactly (8+ characters,
// a lowercase letter, an uppercase letter, a digit) — client-side
// validation as a courtesy, but the backend enforces the same rule
// independently regardless of what this form allows through.
const registerSchema = z
  .object({
    email: z.string().min(1, "Email is required").email("Enter a valid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[a-z]/, "Password must contain a lowercase letter")
      .regex(/[A-Z]/, "Password must contain an uppercase letter")
      .regex(/[0-9]/, "Password must contain a digit"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });
type RegisterFormValues = z.infer<typeof registerSchema>;

export function RegisterPage(): JSX.Element {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({ resolver: zodResolver(registerSchema) });

  async function onSubmit(values: RegisterFormValues): Promise<void> {
    setFormError(null);
    try {
      await signUp({
        email: values.email,
        password: values.password,
        firstName: values.firstName || undefined,
        lastName: values.lastName || undefined,
      });
      // No session is established on registration (repository.js defaults
      // every new account to 'viewer', and signUp() deliberately doesn't
      // sign the person in) — the same two-step flow a real identity
      // provider would also require. The success message travels through
      // router state rather than a query param, so it disappears on
      // refresh rather than lingering in the URL.
      navigate("/login", { state: { registered: true } });
    } catch (err) {
      // WEAK_PASSWORD and EMAIL_TAKEN already carry clear, specific
      // messages from the backend — surfaced verbatim, the same pattern
      // LoginPage uses for its own backend-originated errors.
      if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError("Something went wrong creating your account. Please try again.");
      }
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-neutral-50">
      <div className="w-full max-w-sm rounded shadow-elevation-1 bg-white p-8">
        <h1 className="text-xl font-semibold text-brand-primary mb-6">Create an account</h1>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <TextInput
            label="First name"
            autoComplete="given-name"
            error={errors.firstName?.message}
            {...register("firstName")}
          />
          <TextInput
            label="Last name"
            autoComplete="family-name"
            error={errors.lastName?.message}
            {...register("lastName")}
          />
          <TextInput
            label="Email"
            type="email"
            autoComplete="username"
            required
            error={errors.email?.message}
            {...register("email")}
          />
          <TextInput
            label="Password"
            type="password"
            autoComplete="new-password"
            required
            helperText="At least 8 characters, with an uppercase letter, a lowercase letter, and a digit"
            error={errors.password?.message}
            {...register("password")}
          />
          <TextInput
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            required
            error={errors.confirmPassword?.message}
            {...register("confirmPassword")}
          />
          {formError && (
            <div role="alert" className="text-sm text-status-error">
              {formError}
            </div>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 rounded bg-brand-primary text-white py-2 text-base font-medium disabled:opacity-60"
          >
            {isSubmitting ? "Creating account..." : "Create account"}
          </button>
        </form>
        <p className="mt-4 text-sm text-neutral-600">
          Already have an account? <Link to="/login" className="text-brand-accent">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
