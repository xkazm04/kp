"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { shortDate } from "./jdsLibrary";

type JdAnalysisRow = {
  slug: string;
  candidate_label: string;
  score: number | null;
  role_family: string | null;
  seniority: string | null;
  created_at: string;
};

// The analyzed-candidates roster for one JD, shown inside the detail modal:
// best-score-first, each row deep-linking to /history/[slug]. Lazy-loaded on
// mount (the modal is already an explicit open) — a zero count skips the fetch.
export function JdCandidateList({ slug, count }: { slug: string; count: number }) {
  const t = useTranslations("library.tab");
  const [analyses, setAnalyses] = useState<JdAnalysisRow[] | null>(null);
  // When the JD body last changed (null = never edited). Any analysis scored
  // before this reflects the OLD text — flagged inline, nothing auto re-runs.
  const [jdEditedAt, setJdEditedAt] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setFailed(false);
    setAnalyses(null);
    fetch(`/api/jds/${encodeURIComponent(slug)}/analyses`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((payload) => {
        setAnalyses((payload.analyses as JdAnalysisRow[]) ?? []);
        setJdEditedAt(typeof payload.jdEditedAt === "string" ? payload.jdEditedAt : null);
      })
      .catch(() => setFailed(true));
  };

  // Deferred kickoff so the initial setState lands after commit rather than
  // synchronously in the effect body (react-hooks/set-state-in-effect). A zero
  // count needs no fetch — the empty state renders from the count alone.
  useEffect(() => {
    if (count === 0) return;
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (count === 0) {
    return <p className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-steel">{t("candidatesEmpty")}</p>;
  }
  if (failed) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
        <p className="text-sm text-red-700">{t("candidatesLoadFailed")}</p>
        <button
          type="button"
          onClick={load}
          className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2 py-0.5 text-sm font-semibold text-ink hover:bg-stone-50"
        >
          <RotateCcw size={12} aria-hidden /> {t("tryAgain")}
        </button>
      </div>
    );
  }
  if (analyses == null) {
    return <p className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-steel">{t("candidatesLoading")}</p>;
  }
  return (
    <ul className="divide-y divide-stone-200 rounded-md border border-stone-200 bg-white">
      {analyses.map((row) => {
        // Scored before the JD's last content change ⇒ this score is against stale
        // text. String compare is correct for ISO-8601 UTC timestamps.
        const stale = jdEditedAt != null && row.created_at < jdEditedAt;
        return (
          <li key={row.slug} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <Link href={`/history/${row.slug}`} className="text-sm font-semibold text-ink hover:text-coral hover:underline">
                {row.candidate_label}
              </Link>
              <p className="truncate text-sm capitalize text-steel">
                {row.role_family ?? "—"} · {row.seniority ?? "—"}
              </p>
              {stale ? (
                <span
                  className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-800"
                  title={t("analysisStaleTitle", { date: shortDate(jdEditedAt!) })}
                >
                  <History size={11} aria-hidden /> {t("analysisStale", { date: shortDate(jdEditedAt!) })}
                </span>
              ) : null}
            </div>
            <ScoreBadge score={row.score} />
          </li>
        );
      })}
    </ul>
  );
}
