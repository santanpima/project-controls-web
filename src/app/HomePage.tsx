import { Link } from "react-router-dom";
import { useAuth } from "@shared/auth/AuthContext";

// A genuine placeholder, not a real module screen — every actual feature
// module (WBS, Calendar, Cost, Scheduling, and the rest) still needs its
// own screen built. This exists so RequireAuth has something real to land
// on after sign-in, proving the auth + shell pattern end-to-end before any
// grid- or Gantt-heavy module is attempted. Lives in src/app rather than a
// feature folder — it isn't content owned by any one module.
export function HomePage(): JSX.Element {
  const { user, signOut } = useAuth();

  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold text-brand-primary">
        Welcome{user?.first_name ? `, ${user.first_name}` : ""}
      </h1>
      <p className="mt-2 text-neutral-600">
        Signed in as {user?.email}. Module screens (WBS, Calendar, Cost, Scheduling, and the
        rest) haven&apos;t been built yet — this page exists to prove sign-in and the app shell
        work end-to-end first.
      </p>
      {/* No real Projects list exists yet — no frontend work has been done
          for creating or browsing projects, only the backend API for it.
          This link deliberately uses a literal "demo" projectId so the
          real navigation shell (NavBar, SidePanel, Breadcrumbs, all ten
          module routes) can actually be reached, clicked through, and
          tested end to end, without faking a project-picker that doesn't
          exist yet. */}
      <Link
        to="/projects/demo/wbs"
        className="mt-4 inline-block rounded bg-brand-primary text-white px-4 py-2 text-sm font-medium"
      >
        View demo project shell
      </Link>
      <button
        onClick={signOut}
        className="mt-6 ml-3 rounded border border-neutral-300 px-4 py-2 text-sm text-neutral-700"
      >
        Sign out
      </button>
    </div>
  );
}
