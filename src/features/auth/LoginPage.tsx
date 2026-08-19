import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useState } from "react";
import { useAuth, ApiError } from "@shared/auth/AuthContext";
import { TextInput } from "@shared/components/TextInput";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});
type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginPage(): JSX.Element {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  const locationState = location.state as { from?: { pathname: string }; registered?: boolean } | null;
  const redirectTo = locationState?.from?.pathname ?? "/";
  // Set once, from the state RegisterPage navigated here with — not
  // re-read on every render, so it doesn't reappear if the person
  // navigates away and back without actually registering again.
  const [justRegistered] = useState(!!locationState?.registered);

  async function onSubmit(values: LoginFormValues): Promise<void> {
    setFormError(null);
    try {
      await signIn(values.email, values.password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      // 423 (locked) and 403 (deactivated) get their own real backend
      // messages already — surfaced here verbatim rather than genericized,
      // since they're meaningfully different situations for the person to
      // understand ("try again in 15 minutes" vs. "contact an admin").
      if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError("Something went wrong signing in. Please try again.");
      }
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-neutral-50">
      <div className="w-full max-w-sm rounded shadow-elevation-1 bg-white p-8">
        <h1 className="text-xl font-semibold text-brand-primary mb-6">Sign in</h1>
        {justRegistered && (
          <div role="status" className="mb-4 rounded bg-status-success/10 px-3 py-2 text-sm text-status-success">
            Account created. Sign in below to continue.
          </div>
        )}
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
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
            autoComplete="current-password"
            required
            error={errors.password?.message}
            {...register("password")}
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
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-sm text-neutral-600">
          No account? <Link to="/register" className="text-brand-accent">Register</Link>
        </p>
      </div>
    </div>
  );
}
