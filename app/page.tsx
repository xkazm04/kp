import { Suspense } from "react";
import { Workspace } from "@/app/features/Workspace";
import SparkHome from "@/app/landing/spark/SparkHome";
import { HomeGate } from "@/app/_components/auth/HomeGate";

// '/' is gated: signed-out visitors see the public landing, signed-in operators
// see the workspace dashboard. Both surfaces are server-rendered here and handed
// to HomeGate as slots; it only picks which one to mount (dev-only gate — see
// app/_lib/auth/devAuth.ts). The Suspense boundary is required by Workspace's
// useSearchParams.
//
// `?sim=auto` is the public guided-demo entry (B1): the prospect arrived from
// /api/demo with an isolated demo-workspace session, so force the workspace
// regardless of the dev gate — the param is read here (server) and passed down,
// so HomeGate needs no useSearchParams (and no extra Suspense). The param
// persists across the sim's navigations (it isn't tab-scoped), so demo mode holds
// for the whole run.
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
