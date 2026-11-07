import { Suspense } from "react";
import { redirect } from "next/navigation";
import { hasEnteredWorkspace } from "@/app/_lib/auth/home-gate-server";
import { OneShell } from "@/app/features/one/OneShell";
import { variantOf } from "@/app/features/one/types";

// /one — the recruiter's AI-conducted alternative home (spark `one-interface`, round 2;
// docs/design/one-interface.md). Today's Workspace stays at `/` as the Console.
//
// NOT public: it is absent from app/_lib/auth/public-routes.ts, so proxy.ts walls it when
// a password is set. The page repeats the home gate one layer down (the signed session,
// or open mode's entry marker — hasEnteredWorkspace), so an anonymous visitor in open
// mode lands on the landing at `/` rather than on a recruiter surface.
//
// `?v=greet|split|spotlight|ticker` picks the layout direction (unknown → split), read here on the
// server so the client needs no useSearchParams. The switcher is a judging aid and is
// shown only outside production builds.
//
// Reads cookies and searchParams per request, so it cannot be prerendered under Cache
// Components: block it, the same answer `/`, /me and /control give.
export const instant = false;

export default async function OnePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await hasEnteredWorkspace())) redirect("/");
  const sp = await searchParams;
  const variant = variantOf(typeof sp.v === "string" ? sp.v : undefined);
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <OneShell variant={variant} showSwitcher={process.env.NODE_ENV !== "production"} />
    </Suspense>
  );
}
