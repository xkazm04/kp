import { notFound } from "next/navigation";
import { JetBrains_Mono, Shantell_Sans } from "next/font/google";
import { TranslatedErrorBoundary } from "@/app/_components/ErrorBoundary";
import { isOperator } from "@/app/_lib/auth/require-operator";
import { jobseekerEnabled } from "@/app/_lib/jobseeker/enabled";

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
// Module gate: the whole /me module is OFF unless the install sets KP_JOBSEEKER=1
// (app/_lib/jobseeker/enabled.ts). proxy.ts already answers every /me path as an unknown
// route when it is off; this is the same answer one layer down, so a page stays hidden
// even if a request ever reaches the render without passing the proxy.
// `instant = false`: the layout reads the session per request.
export const instant = false;

// Two faces only /me needs, scoped to this subtree rather than loaded app-wide:
//   --font-me-hand  Shantell Sans, the landing's hand-written voice (app/landing/spark
//                   loads the same face as --font-spark-hand): the flow's eyebrows and
//                   margin notes speak in it, so /me reads as a sibling of the landing
//                   and /about rather than as a workspace tab.
//   --font-me-mono  JetBrains Mono, for tabular meta (counts, dates, keys) and the
//                   designed CV's technical presets (cv.css, always with a fallback).
// The display face stays the product's --font-serif (Fraunces in Studio Light,
// Bricolage in Spark Dark), so the two registers keep their own voices.
const hand = Shantell_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-me-hand",
  weight: ["400", "500", "600"],
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-me-mono",
  display: "swap",
});

export default async function MeLayout({ children }: { children: React.ReactNode }) {
  if (!jobseekerEnabled()) notFound();
  if (!(await isOperator())) notFound();
  return (
    <div className={`min-h-screen bg-paper ${hand.variable} ${mono.variable}`}>
      {/* The boundary speaks the reader's language (errorBoundary.*): a broken step never
          shows a stack. */}
      <TranslatedErrorBoundary label="panel">{children}</TranslatedErrorBoundary>
    </div>
  );
}
