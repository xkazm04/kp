import { Suspense } from "react";
import { redirect } from "next/navigation";
import { hasEnteredWorkspace } from "@/app/_lib/auth/home-gate-server";
import { OneShell } from "@/app/features/one/OneShell";

// /one — the recruiter's AI-conducted home as a full page (spark `one-interface`;
// docs/design/one-interface.md). Round 5: One is also a workspace tab (`/?tab=one`, the
// same shell in its `tab` frame); this page is its full-viewport alias, in the `page`
// frame — the brand, the Console link and Ctrl/⌘ K back to `/`.
//
// NOT public: it is absent from app/_lib/auth/public-routes.ts, so proxy.ts walls it when
// a password is set. The page repeats the home gate one layer down (the signed session,
// or open mode's entry marker — hasEnteredWorkspace), so an anonymous visitor in open
// mode lands on the landing at `/` rather than on a recruiter surface.
//
// Reads cookies per request, so it cannot be prerendered under Cache Components: block it,
// the same answer `/`, /me and /control give.
export const instant = false;

export default async function OnePage() {
  if (!(await hasEnteredWorkspace())) redirect("/");
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <OneShell frame="page" />
    </Suspense>
  );
}
