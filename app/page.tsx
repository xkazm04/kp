import { Suspense } from "react";
import { Workspace } from "@/app/features/Workspace";
import SparkHome from "@/app/landing/spark/SparkHome";
import { HomeGate } from "@/app/_components/auth/HomeGate";

// '/' is gated by HomeGate between two server-rendered slots: the public landing
// (SparkHome) and the workspace dashboard. IMPORTANT — the gate is DEV-ONLY
// (app/_lib/auth/devAuth.ts: DEV_GATE = NODE_ENV !== "production"), so in PRODUCTION
// `/` ALWAYS mounts the dashboard and the public landing is NOT served at any URL
// (/landing redirects to /). The landing (hero, pricing, trust, demo CTA, i18n) is
// BUILT but intentionally NOT LAUNCHED yet — its CTAs still dead-end at the operator
// login and the SEO/social-proof work isn't done (see docs/DESIGN.md "Public landing").
// To launch it, gate `/` on the real auth cookie (isOperator) instead of the dev-only
// localStorage flag, AND finish the CTA/SEO/social-proof items first.
// The Suspense boundary is required by Workspace's useSearchParams.
//
// `?sim=auto` is the public guided-demo entry (B1): the prospect arrived from
// /api/demo with an isolated demo-workspace session, so force the workspace
// regardless of the dev gate — the param is read here (server) and passed down,
// so HomeGate needs no useSearchParams (and no extra Suspense). The param
// persists across the sim's navigations (it isn't tab-scoped), so demo mode holds
// for the whole run.
// '/' awaits searchParams (?sim=auto) and gates on the auth cookie (HomeGate),
// both per-request and outside the Workspace Suspense boundary, so it can't be
// statically prerendered under Cache Components. Block it — its prior behavior.
// (Section switching inside the workspace is ?tab= query state handled
// client-side by Workspace, so it stays instant regardless.)
export const instant = false;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const demoMode = (await searchParams)?.sim === "auto";
  return (
    <HomeGate
      forceDashboard={demoMode}
      landing={<SparkHome />}
      dashboard={
        <Suspense fallback={<div className="min-h-screen bg-paper" />}>
          <Workspace />
        </Suspense>
      }
    />
  );
}
