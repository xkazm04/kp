import { notFound } from "next/navigation";
import { TranslatedErrorBoundary } from "@/app/_components/ErrorBoundary";
import { isOperator } from "@/app/_lib/auth/require-operator";

// /me — the job-seeker's own space, a separate route with its own shell beside the
// recruiter Workspace. It reuses the root layout's providers (theme, locale, brand,
// toaster) and nothing from app/features/shell/Workspace.tsx; the flow's shell (the
// Sieve's top bar and step rail, app/features/jobseeker/sieve/SieveFrame.tsx) is drawn
// by the pages themselves, full-bleed, so this layout is only the gate and the boundary.
// No Companion dock: Candi is the recruiter's companion.
//
// Gate: the route is NOT in PUBLIC_PAGES, so proxy.ts already walls it when a password
// is set; this mirrors app/control/page.tsx and answers a demo-workspace session with the
// same 404 an unknown route gets rather than revealing the surface.
// `instant = false`: the layout reads the session per request.
export const instant = false;

export default async function MeLayout({ children }: { children: React.ReactNode }) {
  if (!(await isOperator())) notFound();
  return (
    <div className="min-h-screen bg-paper">
      {/* The boundary speaks the reader's language (errorBoundary.*): a broken step never
          shows a stack. */}
      <TranslatedErrorBoundary label="panel">{children}</TranslatedErrorBoundary>
    </div>
  );
}
