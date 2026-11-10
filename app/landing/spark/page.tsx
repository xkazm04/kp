import { redirect } from "next/navigation";

// /landing/spark is descoped — the Spark landing is served at '/' now
// (proxy.ts rewrites an anonymous '/' to app/landing/home, which renders SparkHome, the
// app/landing/site/ port). Only the route is removed. Redirect any old link home.
// Legacy redirect stub. It renders under the per-request locale layout, so it
// can't be statically prerendered under Cache Components — Block it (render the
// redirect at request time).
export const instant = false;

export default function SparkRedirect() {
  redirect("/");
}
