"use client";

import { useState } from "react";
import { Check, ClipboardCheck, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { rubricForArchetype, localizedRubric, localizedRatingAnchors, rubricCoverage } from "@/app/_lib/interview-rubric";
import { useRubricStrings } from "@/app/_lib/use-rubric-strings";
import { RATING_MAX } from "@/app/_lib/format";
import type { InterviewRecommendation } from "@/app/_lib/interview-recommendation";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { Scorecard } from "@/app/_lib/interview-scorecard";
import { ScheduleHumanScorecardForm } from "./ScheduleHumanScorecardForm";

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
  roleFamily,
  initial,
}: {
  entryId: string;
  archetype: string | null | undefined;
  // P2-3 — drives the appended industry axes (clinical / trades / scientific …);
  // omit and the panel shows exactly the pre-P2-3 base rubric.
  roleFamily?: string | null;
  initial?: Scorecard | null;
}) {
  const t = useTranslations("scheduleTab.scorecard");
  // Save failures resolve from the machine `code`, never the server's English
  // `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const rubricStrings = useRubricStrings();
  const enumLabel = useEnumLabel();
  // PREP3 — render the rubric in the recruiter's language; the canonical English
  // `competency` stays the POSTed scorecard key (ratings/evidence are keyed by
  // it below), so localizing display can't corrupt the scoring contract.
  const rubric = localizedRubric(rubricForArchetype(archetype, roleFamily), rubricStrings);
  const ratingAnchors = localizedRatingAnchors(rubricStrings);
  // Honest coverage cue, resolved by the SAME pure function the prep header and the
  // scorecard write path use (rubricCoverage), so the pack, the form and the stored
  // record can never disagree about what this rubric covers. It distinguishes "we
  // don't know the role family" from "this family has no industry axes defined" —
  // and never guesses a family to make either go away.
  const coverage = rubricCoverage(roleFamily);
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
  // The save's `gated: true` means the verdict just moved the entry to the
  // scorecard_review gate (DEC1) — disclosed below so the candidate's hop to the
  // Decisions queue isn't a silent disappearing act (interview-prep-rubric #2).
  const [gated, setGated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setRating = (competency: string, rating: number) =>
    setForm((f) => ({ ...f, ratings: { ...f.ratings, [competency]: rating } }));
  const setEvidence = (competency: string, text: string) =>
    setForm((f) => ({ ...f, evidence: { ...f.evidence, [competency]: text } }));

  // Ratings the loaded scorecard carries on a competency that is NOT in TODAY's
  // rubric (a revised interview-rubrics.json, or a since-changed archetype /
  // role family) have no row in this form — the seeded map holds keys nothing on
  // screen can show. Count only what the rubric renders: counting every seeded key
  // read as "6 of 4 rated" on a form where nothing looked selected, and left Save
  // enabled on a payload that would have posted an EMPTY ratings list.
  const rubricKeys = new Set(rubric.map((c) => c.competency.toLowerCase()));
  const ratedCount = rubric.filter((c) => ratings[c.competency] != null).length;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Re-send the ratings this form has no row for (competencies outside today's
      // rubric) unchanged. The write path deliberately KEEPS them and flags them
      // off-rubric — "a scorecard outlives rubric revisions by design"
      // (interview-rubric.ts) — but it can only keep what the form posts, so
      // filtering against the current rubric alone erased them, evidence and all,
      // the moment the recruiter saved again.
      const carried = (initial?.ratings ?? []).filter((r) => !rubricKeys.has(r.competency.toLowerCase()));
      const payloadRatings = rubric
        .filter((c) => ratings[c.competency] != null)
        .map((c) => ({ competency: c.competency, rating: ratings[c.competency], evidence: evidence[c.competency] ?? "" }))
        .concat(carried.map((r) => ({ competency: r.competency, rating: r.rating, evidence: r.evidence ?? "" })));
      const res = await fetch(`/api/interview-prep/scorecard?entry=${encodeURIComponent(entryId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratings: payloadRatings, summary, recommendation: recommendation || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errMsg(d, t("saveFailedStatus", { status: res.status })));
      setSaved(true);
      if (d.gated === true) setGated(true);
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

      <ScheduleHumanScorecardForm
        rubric={rubric}
        ratingAnchors={ratingAnchors}
        ratingMax={RATING_MAX}
        coverage={coverage}
        ratings={ratings}
        evidence={evidence}
        setRating={setRating}
        setEvidence={setEvidence}
        recommendation={recommendation}
        setRecommendation={setRecommendation}
        summary={summary}
        setSummary={setSummary}
        enumLabel={enumLabel}
        t={t}
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
      {gated && !saving ? (
        <p role="status" className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-moss">
          <Check size={14} aria-hidden /> {t("gatedMoved")}
        </p>
      ) : null}
    </section>
  );
}
