"use client";

import { useState } from "react";
import { Check, ClipboardCheck, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { rubricForArchetype, RATING_ANCHORS } from "@/app/_lib/interview-rubric";
import { RATING_MAX } from "@/app/_lib/format";
import { INTERVIEW_RECOMMENDATIONS, type InterviewRecommendation } from "@/app/_lib/interview-recommendation";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { Scorecard } from "@/app/_lib/interview-scorecard";

const REC_STYLE: Record<InterviewRecommendation, string> = {
  advance: "bg-moss text-white",
  hold: "bg-dial-amber text-ink",
  reject: "bg-coral text-white",
};

// Human interviewer scorecard (PREP1). When a HUMAN runs the round there was
// nowhere to record per-competency ratings + evidence — the only scorecard was
// AI-synthesized from the voice screen. This renders the archetype-correct rubric
// (rubricForArchetype, with its BARS anchors) with a 1..RATING_MAX selector +
// evidence per competency, an overall verdict + summary, and saves a
// source:"human" Scorecard onto the prep artifact. Collapsed by default — not
// every prep view is a scoring session.
export function HumanScorecardPanel({
  entryId,
  archetype,
  initial,
}: {
  entryId: string;
  archetype: string | null | undefined;
  initial?: Scorecard | null;
}) {
  const t = useTranslations("scheduleTab.scorecard");
  const enumLabel = useEnumLabel();
  const rubric = rubricForArchetype(archetype);
  const seed = (): { ratings: Record<string, number>; evidence: Record<string, string> } => {
    const ratings: Record<string, number> = {};
    const evidence: Record<string, string> = {};
    for (const r of initial?.ratings ?? []) {
      ratings[r.competency] = r.rating;
      if (r.evidence) evidence[r.competency] = r.evidence;
    }
    return { ratings, evidence };
  };
  const [open, setOpen] = useState(false);
  const [{ ratings, evidence }, setForm] = useState(seed);
  const [recommendation, setRecommendation] = useState<InterviewRecommendation | "">(initial?.recommendation ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(Boolean(initial?.ratings?.length));
  const [error, setError] = useState<string | null>(null);

  const setRating = (competency: string, rating: number) =>
    setForm((f) => ({ ...f, ratings: { ...f.ratings, [competency]: rating } }));
  const setEvidence = (competency: string, text: string) =>
    setForm((f) => ({ ...f, evidence: { ...f.evidence, [competency]: text } }));

  const ratedCount = Object.keys(ratings).length;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payloadRatings = rubric
        .filter((c) => ratings[c.competency] != null)
        .map((c) => ({ competency: c.competency, rating: ratings[c.competency], evidence: evidence[c.competency] ?? "" }));
      const res = await fetch(`/api/interview-prep/scorecard?entry=${encodeURIComponent(entryId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratings: payloadRatings, summary, recommendation: recommendation || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || t("saveFailedStatus", { status: res.status }));
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <section>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-base font-semibold text-ink hover:border-coral/40"
        >
          <ClipboardCheck size={15} className="text-coral" />
          {saved ? t("editScorecard") : t("scoreInterview")}
          {saved ? <Check size={14} className="text-moss" /> : null}
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-coral/30 bg-coral/5 p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
          <ClipboardCheck size={13} /> {t("yourScorecard")}
        </p>
        <button type="button" onClick={() => setOpen(false)} className="focus-ring rounded px-2 py-0.5 text-sm font-semibold text-steel hover:text-ink">
          {t("collapse")}
        </button>
      </div>
      <p className="mt-1 text-sm text-steel">{t("rateEach", { max: RATING_MAX })}</p>

      <div className="mt-3 space-y-3">
        {rubric.map((c) => {
          const chosen = ratings[c.competency];
          const anchorText = chosen != null ? c.anchors?.[String(chosen)] ?? RATING_ANCHORS[chosen] : null;
          return (
            <div key={c.competency} className="rounded-md border border-stone-200 bg-white p-2.5">
              <p className="text-sm font-semibold text-ink">{c.competency}</p>
              <p className="mt-0.5 text-meta text-steel">{c.description}</p>
              <div className="mt-1.5 flex items-center gap-1">
                {Array.from({ length: RATING_MAX }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(c.competency, n)}
                    aria-pressed={chosen === n}
                    className={`focus-ring h-7 w-7 rounded-md text-sm font-semibold ${
                      chosen === n ? "bg-ink text-white" : "border border-stone-200 text-steel hover:border-coral/40"
                    }`}
                  >
                    {n}
                  </button>
                ))}
                {anchorText ? <span className="ml-2 text-meta text-steel">{anchorText}</span> : null}
              </div>
              <textarea
                value={evidence[c.competency] ?? ""}
                onChange={(e) => setEvidence(c.competency, e.target.value)}
                rows={2}
                placeholder={t("evidencePlaceholder")}
                className="focus-ring mt-2 w-full rounded-md border border-stone-200 bg-white p-1.5 text-sm text-ink"
              />
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">{t("verdict")}</span>
        {INTERVIEW_RECOMMENDATIONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRecommendation((cur) => (cur === r ? "" : r))}
            aria-pressed={recommendation === r}
            className={`focus-ring rounded-full px-3 py-1 text-sm font-semibold capitalize transition-colors ${
              recommendation === r ? REC_STYLE[r] : "border border-stone-200 text-steel hover:border-coral/40"
            }`}
          >
            {enumLabel("recommendation", r)}
          </button>
        ))}
      </div>
      <textarea
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        rows={2}
        placeholder={t("summaryPlaceholder")}
        className="focus-ring mt-2 w-full rounded-md border border-stone-200 bg-white p-2 text-sm text-ink"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || ratedCount === 0}
          className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-coral px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {saving ? t("saving") : t("saveScorecard")}
        </button>
        <span className="text-meta text-steel">{t("ratedCount", { rated: ratedCount, total: rubric.length })}</span>
        {saved && !saving ? <span className="text-sm font-semibold text-moss">{t("saved")}</span> : null}
        {error ? <span className="text-sm text-coral">{error}</span> : null}
      </div>
    </section>
  );
}
