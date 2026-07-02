"use client";

import { useTranslations } from "next-intl";
import { Skeleton } from "@/app/_components/Skeleton";
import { PANEL } from "@/app/_components/ui/recipes";

// Shared route-level loading fallback — what a segment `loading.tsx` shows
// while its (often force-dynamic, sqlite-backed) server render streams in.
// Three shapes, mirroring the three page geometries so the skeleton reserves
// roughly the real layout's height (no reflow jump when content lands):
//
//   card — the centered candidate card (offer/[token], onboarding/[token]);
//          mirrors the offer page's own in-card skeleton.
//   page — the narrow single-column flow (schedule/[token], apply/[id],
//          skill/[token], devcase/apply/[token]): eyebrow, display title,
//          intro, then a panel block.
//   wide — the wide report/two-column surfaces (interview/[token],
//          history/[slug], jds/[slug]).
//
// Client component on purpose: loading fallbacks render inside the root
// layout, so NextIntlClientProvider is above and useTranslations localizes the
// status label synchronously (an async server fallback would defeat the
// point of an instant fallback). The Skeleton primitive already disables its
// pulse under prefers-reduced-motion.
export type RouteLoadingVariant = "card" | "page" | "wide";

export function RouteLoading({ variant = "page" }: { variant?: RouteLoadingVariant }) {
  const t = useTranslations("common");

  if (variant === "card") {
    return (
      <main
        role="status"
        aria-label={t("loading")}
        className="flex min-h-screen items-center justify-center bg-paper p-6"
      >
        <div className={`${PANEL} w-full max-w-md rounded-xl p-7`}>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-11 w-11 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-3/4" />
            <div className="flex gap-2 pt-2">
              <Skeleton className="h-10 flex-1 rounded-md" />
              <Skeleton className="h-10 flex-1 rounded-md" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (variant === "wide") {
    return (
      <main role="status" aria-label={t("loading")} className="mx-auto max-w-[1380px] px-4 py-10">
        <div className="max-w-3xl space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <div className="mt-8 grid items-start gap-8 lg:grid-cols-[360px_minmax(0,1fr)]">
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="h-96 w-full rounded-lg" />
        </div>
      </main>
    );
  }

  return (
    <main role="status" aria-label={t("loading")} className="mx-auto max-w-xl px-4 py-12">
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
      <Skeleton className="mt-6 h-64 w-full rounded-lg" />
    </main>
  );
}
