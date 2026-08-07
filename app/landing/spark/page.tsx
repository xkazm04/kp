import { redirect } from "next/navigation";

// /landing/spark is descoped — the Spark landing is served at '/' now
// (app/page.tsx renders SparkHome via the HomeGate). The SparkHome/SparkLanding
// components stay in this folder as the home/marketing component library; only
// the route is removed. Redirect any old link home.
// Legacy redirect stub. It renders under the per-request locale layout, so it
// can't be statically prerendered under Cache Components — Block it (render the
// redirect at request time).
export const instant = false;

export default function SparkRedirect() {
  redirect("/");
}
