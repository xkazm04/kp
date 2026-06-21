import { redirect } from "next/navigation";

// /landing/spark is descoped — the Spark landing is served at '/' now
// (app/page.tsx renders SparkHome via the HomeGate). The SparkHome/SparkLanding
// components stay in this folder as the home/marketing component library; only
// the route is removed. Redirect any old link home.
export default function SparkRedirect() {
  redirect("/");
}
