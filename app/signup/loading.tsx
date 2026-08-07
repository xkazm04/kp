import { RouteLoading } from "@/app/_components/RouteLoading";

// Route-level loading fallback for /signup — same rationale as /login/loading:
// the Suspense boundary lets the segment prerender an instant static shell
// while the per-request layout (locale) and the client bundle stream in.
export default function Loading() {
  return <RouteLoading variant="card" />;
}
