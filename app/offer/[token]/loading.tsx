import { RouteLoading } from "@/app/_components/RouteLoading";

// Route-level loading fallback for /offer/[token] — shown while the segment's
// client bundle + first data render streams in. The "card" variant mirrors this page's real
// geometry so content lands without a layout jump; the shimmer is
// reduced-motion safe (Skeleton primitive).
export default function Loading() {
  return <RouteLoading variant="card" />;
}
