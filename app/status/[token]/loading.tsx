import { RouteLoading } from "@/app/_components/RouteLoading";

// Route-level loading fallback for /status/[token] — provides the Suspense
// boundary that lets this "use client" segment prerender an instant static shell
// under Cache Components while the per-request layout (locale) and the client
// bundle stream in. Without a boundary the shared layout's cookie-based locale
// read blocks the prerender entirely.
export default function Loading() {
  return <RouteLoading variant="card" />;
}
