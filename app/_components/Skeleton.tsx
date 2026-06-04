// Shared loading-shimmer primitive. The pulse is disabled under
// prefers-reduced-motion so motion-sensitive users see a static block. This is the
// single source for the shimmer's color + reduced-motion treatment across the app
// (LibraryTab, MatchShared, Workspace, …); pass `className` for size/shape.
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-stone-200/80 motion-reduce:animate-none ${className}`} />;
}
