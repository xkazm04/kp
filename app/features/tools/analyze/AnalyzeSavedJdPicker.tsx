"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Select } from "@/app/_components/Select";
import type { JdSummary } from "./AnalyzeTypes";

export function AnalyzeSavedJdPicker({
  jds,
  selectedSlug,
  loading = false,
  loadFailed = false,
  onPick,
  onClear,
}: {
  jds: JdSummary[];
  selectedSlug: string | null;
  loading?: boolean;
  // The last pick's body fetch failed (stale list after a delete/rename, network
  // error) — the hook detached the slug; tell the recruiter why the pick vanished.
  loadFailed?: boolean;
  onPick: (jd: JdSummary) => void;
  onClear: () => void;
}) {
  const t = useTranslations("analyze");
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
        size="sm"
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
