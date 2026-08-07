"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, INTRO, PANEL } from "@/app/_components/ui/recipes";

// Shared route-level error fallback — the branded panel every segment
// `error.tsx` (and the root one) renders instead of Next's unstyled default.
// It sits BELOW the root layout, so NextIntlClientProvider is still mounted
// and useTranslations resolves the visitor's locale like any other client
// surface. Same vocabulary as the in-workspace ErrorBoundary
// (app/_components/ErrorBoundary.tsx) but full-page: the crash replaced the
// whole route segment, so the fallback owns the viewport.
//
// The signature matches the App Router error-file contract, so segment files
// can simply `export { RouteError as default }` under their own "use client".
export function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("resilience");

  useEffect(() => {
    // No remote error sink is wired up; the console keeps the stack (and the
    // server-side digest correlation id) for diagnosis.
    console.error("Route render failed:", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-6">
      <div role="alert" className={`${PANEL} animate-fade-in w-full max-w-md p-7 text-center`}>
        <AlertTriangle size={22} className="mx-auto text-coral" aria-hidden />
        <p className={`mt-3 ${EYEBROW}`}>{t("errorEyebrow")}</p>
        <h1 className="mt-1 font-serif text-h2 text-ink">{t("errorTitle")}</h1>
        <p className={`mt-2 ${INTRO}`}>{t("errorBody")}</p>
        {error.digest ? (
          <p className="mt-2 font-mono text-sm text-steel">{t("errorDigest", { digest: error.digest })}</p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button type="button" onClick={reset} className={`${BTN_PRIMARY} h-10 px-4`}>
            <RotateCcw size={14} aria-hidden /> {t("retry")}
          </button>
          <Link href="/" className={`${BTN_SECONDARY} h-10 px-4`}>
            {t("home")}
          </Link>
        </div>
      </div>
    </main>
  );
}
