import { Suspense } from "react";
import { Workspace } from "@/app/features/Workspace";
import SparkHome from "@/app/landing/spark/SparkHome";
import { hasEnteredWorkspace } from "@/app/_lib/auth/home-gate-server";

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
  const demoMode = (await searchParams)?.sim === "auto";
  const entered = demoMode || (await hasEnteredWorkspace());
  if (!entered) return <SparkHome />;
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <Workspace />
    </Suspense>
  );
}
