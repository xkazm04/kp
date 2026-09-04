"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Select } from "@/app/_components/Select";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";
import type { JdSummary } from "./AnalyzeTypes";
import type { JdLibraryState } from "./analyzeJdLibraryState";

export function AnalyzeSavedJdPicker({
  jds,
  libraryState,
  onRetryLibrary,
  selectedSlug,
  loading = false,
  loadFailed = false,
  onPick,
  onClear,
}: {
  jds: JdSummary[];
  /** Whether the LIBRARY LIST loaded — a different fact from `loadFailed`, which
   *  is about one picked JD's body. An empty `jds` used to mean all three of
   *  loading / genuinely empty / failed, and this surface showed the middle one. */
  libraryState: JdLibraryState;
  onRetryLibrary: () => void;
  selectedSlug: string | null;
  loading?: boolean;
  // The last pick's body fetch failed (stale list after a delete/rename, network
  // error) — the hook detached the slug; tell the recruiter why the pick vanished.
  loadFailed?: boolean;
  onPick: (jd: JdSummary) => void;
  onClear: () => void;
}) {
  const t = useTranslations("analyze");
  // The route answers a store fault with a CODE (JD_LIST_FAILED), so the reason
  // resolves in the reader's language instead of the client rendering a server
  // string. The hook does not keep the payload — the code is the one the list
  // route publishes — so the resolver is handed it explicitly.
  const errorMessage = useErrorMessage();
  // Still in flight: say so instead of asserting an empty library.
  if (libraryState === "loading" && jds.length === 0) {
    return (
      <p role="status" className="rounded-md border border-dashed border-stone-300 bg-white p-2 text-sm text-steel">
        {t("jdLibraryLoading")}
      </p>
    );
  }
  // The list request itself failed. Distinct from the "no JDs saved" line below,
  // which is a claim about the recruiter's data — one we can only make once a
  // load has actually succeeded.
  if (libraryState === "failed") {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-coral/50 bg-white p-2"
      >
        <p className="text-sm font-medium text-coral">
          {errorMessage({ code: "JD_LIST_FAILED" }, t("jdLibraryFailed"))}
        </p>
        <button type="button" onClick={onRetryLibrary} className={BTN_SECONDARY}>
          {t("jdLibraryRetry")}
        </button>
      </div>
    );
  }
  if (jds.length === 0) {
    // A failed load is NOT an empty library. `loadFailed` is otherwise only
    // rendered in the populated branch below, so a ?jd= deep link whose body
    // fetch failed (a deleted slug, or the same outage that left this list
    // empty) fell through to "No JDs saved. Save one for reuse." — a claim about
    // the library the client never confirmed, with the one message explaining
    // why the pick vanished unreachable. Prefer the failure.
    if (loadFailed) {
      return (
        <p
          role="alert"
          className="rounded-md border border-dashed border-coral/50 bg-white p-2 text-sm font-medium text-coral"
        >
          {t("jdLoadFailed")}
        </p>
      );
    }
    return (
      <p className="rounded-md border border-dashed border-stone-300 bg-white p-2 text-sm text-steel">
        {t.rich("noJds", {
          link: (chunks) => (
            <Link href="/?tab=library" className="font-semibold text-coral underline-offset-2 hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    );
  }
  return (
    <div className="rounded-md bg-white p-2">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor="saved-jd-picker"
          className="text-sm font-semibold uppercase tracking-wide text-steel"
        >
          {t("fromLibrary")}
        </label>
        {loading ? (
          <span role="status" className="text-sm font-medium text-steel">{t("loadingJd")}</span>
        ) : selectedSlug ? (
          <button
            type="button"
            onClick={onClear}
            className="text-sm font-medium text-coral underline-offset-2 hover:underline"
          >
            {t("detach")}
          </button>
        ) : loadFailed ? (
          <span role="alert" className="text-right text-sm font-medium text-coral">{t("jdLoadFailed")}</span>
        ) : null}
      </div>
      <Select
        id="saved-jd-picker"
        ariaLabel={t("fromLibrary")}
        value={selectedSlug ?? ""}
        disabled={loading}
        sizeVariant="sm"
        className="mt-1 w-full"
        onChange={(slug) => {
          if (!slug) {
            onClear();
            return;
          }
          const jd = jds.find((entry) => entry.slug === slug);
          if (jd) onPick(jd);
        }}
        options={[
          { value: "", label: t("pickJd") },
          ...jds.map((jd) => ({
            value: jd.slug,
            label: t("jdOption", { title: jd.title.length > 40 ? `${jd.title.slice(0, 38)}…` : jd.title, slug: jd.slug }),
          })),
        ]}
      />
    </div>
  );
}
