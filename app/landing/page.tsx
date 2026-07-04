import { redirect } from "next/navigation";

// The landing now lives at '/' (gated by sign-in; see app/page.tsx → HomeGate),
// so the standalone /landing routes are descoped. Keep this as a redirect so any
// stale bookmark lands on the canonical home instead of 404ing.
// Legacy redirect stub. It renders under the per-request locale layout, so it
// can't be statically prerendered under Cache Components — Block it (render the
// redirect at request time).
export const instant = false;

export default function LandingRedirect() {
  redirect("/");
}
