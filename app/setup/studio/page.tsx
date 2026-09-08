import { SetupStudio } from "@/app/features/setup-studio/SetupStudio";

export const metadata = { title: "Onboarding studio" };

// Increment 2 of docs/concepts/onboarding-in-app.md: the app-native face of the
// installer. The ENGINE stays outside the app — scripts/onboard-ui/server.mjs
// keeps the CLI child, the permission hook and the env-file writes, so a repair
// journey survives the app it is repairing going down. This page opens that
// server's SSE stream cross-origin and posts back to it; there is no route of
// our own in between, which is why nothing here is added to the API reference.
//
// AUTH POSTURE — the same one /interview-lab has, and it is the proxy's:
// `/setup/studio` is NOT in PUBLIC_PAGES (app/_lib/auth/public-routes.ts), so
// the fail-closed gate in proxy.ts sends an unauthenticated visitor to /login
// whenever KP_OPERATOR_PASSWORD is set, and lets them straight in when it is not
// (open dev mode, which is the mode a machine being installed is in). No
// page-level requireOperator: this page reads no workspace data and holds no
// capability of its own — the only thing it can act on is a wizard token the
// visitor already had, in a URL fragment the server never sees.
//
// Blocked under Cache Components: the root layout resolves the locale and reads
// headers per request, so there is no useful static shell to prerender, and the
// whole surface is a client tree driven by an EventSource. `instant` is route
// segment config, so it lives on this Server Component wrapper while the
// interactive UI stays in the "use client" child.
export const instant = false;

export default function SetupStudioPage() {
  return <SetupStudio />;
}
