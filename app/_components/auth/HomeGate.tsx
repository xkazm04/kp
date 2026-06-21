"use client";

import { useDevAuth } from "@/app/_lib/auth/devAuth";

/*
 * Homepage gate. '/' renders the public landing for signed-out visitors and the
 * workspace dashboard once signed in. Both subtrees are handed in as
 * server-rendered slots (see app/page.tsx) so this client component only picks
 * which one to mount — it owns no markup of its own beyond the splash.
 *
 * `null` is the one pre-mount frame in development before localStorage is read;
 * we paint a neutral paper screen (matching the layout's loading fallback)
 * instead of flashing the landing at a signed-in user or vice-versa. In
 * production the gate is disabled and resolves straight to the dashboard.
 */
export function HomeGate({
  landing,
  dashboard,
  forceDashboard = false,
}: {
  landing: React.ReactNode;
  dashboard: React.ReactNode;
  // Public guided-demo entry (B1): '/?sim=auto' renders the workspace regardless
  // of the dev gate, since the prospect holds an isolated demo-workspace session.
  forceDashboard?: boolean;
}) {
  const authed = useDevAuth();
  if (forceDashboard) return <>{dashboard}</>;
  if (authed === null) return <div className="min-h-screen bg-paper" aria-hidden />;
  return <>{authed ? dashboard : landing}</>;
}
