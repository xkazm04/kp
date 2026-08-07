"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

// W0.6b — the candidate-NPS card on the public status page.
//
// Shown ONLY on a terminal outcome (the route decides; this component just asks). kp
// argues that telling a rejected candidate why is a better experience than ghosting
// them — this is where that stops being an assertion and becomes a number.
//
// Deliberately low-friction and low-pressure: one 0-10 row, an optional comment, and no
// nagging. Once answered it thanks and stops asking, so a candidate who polls the page
// for weeks is never re-prompted.

const SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

type NpsState = { asked: boolean; answered: { score: number; comment: string | null } | null };

export function StatusNpsCard({ token }: { token: string }) {
  const t = useTranslations("status.nps");
  const [state, setState] = useState<NpsState | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/status/${token}/nps`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: NpsState | null) => {
        if (live && d) setState(d);
      })
      .catch(() => {
        /* the card simply does not render — a feedback prompt is never worth an error banner */
      });
    return () => {
      live = false;
    };
  }, [token]);

  const submit = useCallback(async () => {
    if (score == null || submitting) return;
    setSubmitting(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/status/${token}/nps`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ score, comment }),
      });
      if (!res.ok) throw new Error("submit failed");
      setState({ asked: true, answered: { score, comment: comment.trim() || null } });
    } catch {
      // Honest failure: the answer was NOT recorded, so say so rather than thanking
      // them for feedback we dropped.
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  }, [score, comment, submitting, token]);

  if (!state?.asked) return null;

  if (state.answered) {
    return (
      <section className="mt-8 rounded-lg border border-stone-200 bg-paper p-4">
        <p className="text-base text-steel">{t("thanks")}</p>
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-lg border border-stone-200 bg-paper p-4" aria-labelledby="status-nps-title">
      <h2 id="status-nps-title" className="text-body font-semibold text-ink">
        {t("title")}
      </h2>
      <p className="mt-1 text-base text-steel">{t("subtitle")}</p>

      <div className="mt-3 flex flex-wrap gap-1" role="radiogroup" aria-label={t("title")}>
        {SCORES.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={score === n}
            onClick={() => setScore(n)}
            className={`focus-ring h-9 w-9 rounded-md border text-base font-semibold transition-colors ${
              score === n ? "border-coral bg-coral/10 text-coral" : "border-stone-300 bg-white text-steel hover:border-coral/40"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-meta text-steel">
        <span>{t("scaleLow")}</span>
        <span>{t("scaleHigh")}</span>
      </div>

      <label className="mt-3 block">
        <span className="sr-only">{t("commentLabel")}</span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder={t("commentPlaceholder")}
          className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base text-ink placeholder:text-steel"
        />
      </label>

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={score == null || submitting}
          className="focus-ring rounded-md bg-ink px-3 py-1.5 text-base font-semibold text-white disabled:opacity-40"
        >
          {submitting ? t("sending") : t("send")}
        </button>
        {failed ? <span className="text-base text-red-600">{t("failed")}</span> : null}
      </div>
    </section>
  );
}
