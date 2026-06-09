"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { JdSummary } from "./AnalyzeTypes";

export function AnalyzeSavedJdPicker({
  jds,
  selectedSlug,
  loading = false,
  onPick,
  onClear,
}: {
  jds: JdSummary[];
  selectedSlug: string | null;
  loading?: boolean;
  onPick: (jd: JdSummary) => void;
  onClear: () => void;
}) {
  const t = useTranslations("analyze");
  if (jds.length === 0) {
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
        ) : null}
      </div>
      <select
        id="saved-jd-picker"
        value={selectedSlug ?? ""}
        disabled={loading}
        onChange={(event) => {
          const slug = event.target.value;
          if (!slug) {
            onClear();
            return;
          }
          const jd = jds.find((entry) => entry.slug === slug);
          if (jd) onPick(jd);
        }}
        className="focus-ring mt-1 h-9 w-full rounded-md border border-stone-300 bg-white px-2 text-sm text-ink"
      >
        <option value="">{t("pickJd")}</option>
        {jds.map((jd) => (
          <option key={jd.slug} value={jd.slug}>
            {t("jdOption", { title: jd.title.length > 40 ? `${jd.title.slice(0, 38)}…` : jd.title, slug: jd.slug })}
          </option>
        ))}
      </select>
    </div>
  );
}
