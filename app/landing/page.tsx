import { redirect } from "next/navigation";

// The landing now lives at '/' (gated by sign-in; see app/page.tsx → HomeGate),
// so the standalone /landing routes are descoped. Keep this as a redirect so any
// stale bookmark lands on the canonical home instead of 404ing.
export default function LandingRedirect() {
  redirect("/");
}
