"use client";

import Link from "next/link";
import type { JdSummary } from "./AnalyzeTypes";

export function AnalyzeSavedJdPicker({
  jds,
  selectedSlug,
  onPick,
  onClear,
}: {
  jds: JdSummary[];
  selectedSlug: string | null;
  onPick: (jd: JdSummary) => void;
  onClear: () => void;
}) {
  if (jds.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-stone-300 bg-white p-2 text-[11px] text-steel">
        No JDs saved.{" "}
        <Link
          href="/?tab=library"
          className="font-semibold text-coral underline-offset-2 hover:underline"
        >
          Save one
        </Link>{" "}
        for reuse.
      </p>
    );
  }
  return (
    <div className="rounded-md bg-white p-2">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor="saved-jd-picker"
          className="text-[11px] font-semibold uppercase tracking-wide text-steel"
        >
          From library
        </label>
        {selectedSlug ? (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] font-medium text-coral underline-offset-2 hover:underline"
          >
            Detach
          </button>
        ) : null}
      </div>
      <select
        id="saved-jd-picker"
        value={selectedSlug ?? ""}
        onChange={(event) => {
          const slug = event.target.value;
          if (!slug) {
            onClear();
            return;
          }
          const jd = jds.find((entry) => entry.slug === slug);
          if (jd) onPick(jd);
        }}
        className="focus-ring mt-1 h-9 w-full rounded-md border border-stone-300 bg-white px-2 text-xs text-ink"
      >
        <option value="">Pick a saved JD…</option>
        {jds.map((jd) => (
          <option key={jd.slug} value={jd.slug}>
            {jd.title.length > 40 ? `${jd.title.slice(0, 38)}…` : jd.title} ({jd.slug})
          </option>
        ))}
      </select>
    </div>
  );
}
