import { RouteLoading } from "@/app/_components/RouteLoading";

// Route-level loading fallback for /invite/[token] — the invited member's
// set-your-password form. page.tsx has claimed this file since the Cache
// Components opt-out landed; it did not exist until 2026-09-01, so navigation
// fell through to the root fallback. The "card" variant mirrors the form's
// geometry so content lands without a layout jump; the shimmer is
// reduced-motion safe (Skeleton primitive).
export default function Loading() {
  return <RouteLoading variant="card" />;
}
