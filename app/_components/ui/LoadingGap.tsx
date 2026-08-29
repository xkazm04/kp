"use client";

import { useTranslations } from "next-intl";

// The quiet reserved box a surface shows while its data or its chunk arrives —
// with a name.
//
// The visual is unchanged and deliberate: `reveal-quiet` + a min-height, never a
// shimmering skeleton. What changes is that it stops being invisible to assistive
// tech. These gaps were `<div className="reveal-quiet …" aria-hidden />`, so a
// screen-reader user reached a silent empty region and had no way to tell "still
// loading" from "this section is empty" — the one distinction the box exists to
// make for sighted readers.
//
// WHEN TO USE THIS, AND WHEN aria-hidden IS RIGHT:
//
//   • Use LoadingGap when the box stands in for a WHOLE view or panel body the
//     reader is waiting on. That wait is a status worth announcing.
//   • Keep a bare `aria-hidden` placeholder for an INLINE shimmer that stands in
//     for one value inside a row that is already rendered and announced (the
//     `inline-block h-4 w-24 rounded bg-stone-100` shape). Those are decoration:
//     the row around them already says what is there, and announcing "Loading"
//     once per cell would be far worse than saying nothing.
//   • Where several gaps mount at once BELOW an already-rendered heading, prefer
//     one status region on the section over one per panel, for the same reason.
//
// HONEST LIMIT: this makes the wait DISCOVERABLE, not announced-on-arrival. The
// region unmounts when the content replaces it, and a live region that disappears
// cannot announce what took its place. Announcing arrival needs a stable region
// owned by the section that outlives the swap — a bigger change than naming the
// box, and worth doing when a reader asks for it rather than speculatively.
export function LoadingGap({
  className = "",
  /** Overrides the default "Loading…" when a surface can say what it is loading. */
  label,
}: {
  className?: string;
  label?: string;
}) {
  const t = useTranslations("common");
  return (
    <div className={`reveal-quiet ${className}`} role="status" aria-busy="true">
      <span className="sr-only">{label ?? t("loading")}</span>
    </div>
  );
}
