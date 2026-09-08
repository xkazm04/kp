import { Suspense } from "react";
import { Workspace } from "@/app/features/shell/Workspace";
import SparkHome from "@/app/landing/spark/SparkHome";
import { hasEnteredWorkspace } from "@/app/_lib/auth/home-gate-server";
import { needsOnboarding } from "@/app/_lib/auth/onboarding-gate";
import { signupEnabled } from "@/app/_lib/workspace-lock";

// '/' is gated SERVER-SIDE between two surfaces: the public landing (SparkHome)
// for anonymous visitors, and the workspace dashboard once signed in. The gate is
// hasEnteredWorkspace() (app/_lib/auth/home-gate-server.ts): the real signed
// session in password mode, or the readable entry marker in open mode. Because the
// decision is server-side, the landing is server-rendered for anonymous visitors —
// crawlable (see robots.ts/sitemap.ts) and with no landing↔dashboard flash.
// The Suspense boundary is required by Workspace's useSearchParams.
//
// `?sim=auto` is the public guided-demo entry (B1): the prospect arrived from
// /api/demo with an isolated demo-workspace session, so force the workspace
// regardless of the gate — the param is read here (server), so no useSearchParams
// (and no extra Suspense) is needed for it. The param persists across the sim's
// navigations (it isn't tab-scoped), so demo mode holds for the whole run.
// '/' awaits searchParams (?sim=auto) and reads cookies (the gate), both
// per-request and outside the Workspace Suspense boundary, so it can't be
// statically prerendered under Cache Components. Block it — its prior behavior.
// (Section switching inside the workspace is ?tab= query state handled
// client-side by Workspace, so it stays instant regardless.)
export const instant = false;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const demoMode = sp?.sim === "auto";
  const entered = demoMode || (await hasEnteredWorkspace());
  // `signupOpen` is the ONE bit of deployment policy the landing needs: whether
  // /signup exists on this deploy (KP_SIGNUP_ENABLED — the page 404s when unset,
  // which the client cannot detect). Resolved here with the same predicate the
  // page and the register route use, never re-parsed from a NEXT_PUBLIC_ mirror,
  // so the hero's primary CTA can send a refused (gated-deploy) visitor to a
  // surface where a stranger can actually finish. Pure env read — the anonymous
  // landing stays DB-free.
  if (!entered) return <SparkHome signupOpen={signupEnabled()} />;
  // First-run gate: a principal (user, or workspace in open mode) that has never
  // completed/skipped the setup wizard gets it as an overlay on first entry.
  // `?onboarding=1` is the single-load dev escape hatch (KP_FORCE_ONBOARDING=1
  // is the every-load one). Demo sessions are excluded inside the gate — after
  // the entered check, so the anonymous landing stays DB-free.
  const firstRunOnboarding = !demoMode && (sp?.onboarding === "1" || (await needsOnboarding()));
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <Workspace firstRunOnboarding={firstRunOnboarding} />
    </Suspense>
  );
}
