import { RouteLoading } from "@/app/_components/RouteLoading";

// Route-level loading fallback for /history/[slug] — shown while the segment's
// force-dynamic server render streams in. The "wide" variant mirrors this page's real
// geometry so content lands without a layout jump; the shimmer is
// reduced-motion safe (Skeleton primitive).
export default function Loading() {
  return <RouteLoading variant="wide" />;
}
