// Shared loading-shimmer primitive. The pulse is disabled under
// prefers-reduced-motion so motion-sensitive users see a static block. This is the
// single source for the shimmer's color + reduced-motion treatment across the app
// (jds ledger, match surfaces, …); pass `className` for size/shape.
//
// Loading choreography forbids new skeletons. Existing call sites are a per-file
// ceiling in `skeleton-debt.json` (enforced by `skeleton-debt.test.ts`). A new
// file with `<Skeleton` is undeclared. Prefer `<LoadingGap>`.
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-stone-200/80 motion-reduce:animate-none ${className}`} />;
}
