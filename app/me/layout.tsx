import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { TranslatedErrorBoundary } from "@/app/_components/ErrorBoundary";
import { currentSession } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { isOperator } from "@/app/_lib/auth/require-operator";
import { currentUserId } from "@/app/_lib/auth/session";
import { countJobseekerPostingsNewSince } from "@/app/_lib/db/jobseeker-postings";
import { getFeedAnchor, getJobseekerProfile } from "@/app/_lib/db/jobseeker-profiles";
import { MeNav } from "@/app/features/jobseeker/MeNav";

// /me — the job-seeker's own workspace, a THIN shell beside the recruiter Workspace
// (design wave 1, 2026-09-16: a separate route with its own shell, not a mode of the
// tab-driven shell). It reuses the root layout's providers (theme, locale, brand,
// toaster) and the two rail islands every shell shares — the brand mark and the
// appearance/language preferences — and nothing from app/features/shell/Workspace.tsx.
// No Companion dock: Candi is the recruiter's companion.
//
// Gate: the route is NOT in PUBLIC_PAGES, so proxy.ts already walls it when a
// password is set; this mirrors app/control/page.tsx and answers a demo-workspace
// session with the same 404 an unknown route gets rather than revealing the surface.
// `instant = false`: the layout reads the session and the locale per request.
//
// The rail is `print:hidden`: /me/cv/print renders the polished CV for paper, and a
// navigation column on an A4 sheet is chrome the reader never asked to print.
export const instant = false;

export default async function MeLayout({ children }: { children: React.ReactNode }) {
  if (!(await isOperator())) notFound();
  const t = await getTranslations("me");
  // The rail's Jobs badge is DERIVED here, on the server, from the seeker's stored
  // anchor — one comparison, no client fetch and no maintained counter. No profile or no
  // anchor (the first visit) counts nothing, and MeNav renders no badge for a zero.
  const [session, ws] = await Promise.all([currentSession(), currentWorkspace()]);
  const profile = getJobseekerProfile(currentUserId(session), ws);
  const anchor = profile ? getFeedAnchor(profile.id, ws) : null;
  const jobsNew = anchor ? countJobseekerPostingsNewSince(anchor, ws) : 0;
  return (
    <div className="min-h-screen bg-paper md:flex">
      <MeNav label={t("title")} jobsNew={jobsNew} />
      <main className="min-w-0 flex-1 bg-paper">
        <div className="mx-auto max-w-[108rem] px-4 py-8 sm:px-6 lg:px-8 print:max-w-none print:px-0 print:py-0">
          {/* The boundary speaks the reader's language (errorBoundary.*) — a broken
              panel never takes the rail with it, and never shows a stack. */}
          <TranslatedErrorBoundary label="panel">{children}</TranslatedErrorBoundary>
        </div>
      </main>
    </div>
  );
}
