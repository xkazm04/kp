"use client";

// UAT KAT-L1-002 (blocker, recurrence 2) — the capture surface the quality-of-hire
// question was missing. The 1..5 on-the-job rating existed in the schema and had
// exactly one writer: the dev-case control room. A recruiter or hiring manager
// looking at someone this workspace actually hired could not say how the hire
// worked out, so "did the 90 %-match candidates get hired AND stay?" had no data
// path at all. This is that path, at the surface where the hire is already open.
//
// Why it is HERE and not on the board: the rating is a judgement about a named
// person, so it belongs behind the same operator-gated drawer as the candidate's
// comms, scorecard and consent record — never on a hover affordance in a column.
//
// It renders only for a hire (the drawer mounts it on a terminal-role stage, and
// the route re-checks the LIVE stage before it will write). An unrated hire reads
// as unrated: there is no default, no pre-selected value and no zero.

import { useCallback, useEffect, useState } from "react";
import { Sprout } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { TOGGLE_GROUP, toggleBtn } from "@/app/_components/ui/recipes";

type HireOutcomeView = {
  entryId: string;
  hired: boolean;
  performance: number | null;
  recordedAt: string | null;
  min: number;
  max: number;
};

export function PipelineHireOutcomeCard({ entryId }: { entryId: string }) {
  const t = useTranslations("pipeline.drawer.hireOutcome");
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const [view, setView] = useState<HireOutcomeView | null>(null);
  const [saving, setSaving] = useState(false);
  // The localized refusal, not a boolean: the route answers 404/400/409 with a
  // machine code, and "why the rating was refused" is the useful half.
  const [failed, setFailed] = useState<string | null>(null);

  // Its own small read, fired ONLY for a hire — the drawer's one-call bundle stays
  // one call for every other candidate, which is the deliberate property the bundle
  // exists for. A failed load leaves the card silent rather than showing a control
  // that cannot save.
  useEffect(() => {
    let live = true;
    fetch(`/api/pipeline/outcomes?entry=${encodeURIComponent(entryId)}`)
      .then((r) => r.json())
      .then((p) => {
        if (!live) return;
        if (p.error) throw new Error(p.error);
        setView(p as HireOutcomeView);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [entryId]);

  const rate = useCallback(
    async (performance: number) => {
      setSaving(true);
      setFailed(null);
      try {
        const res = await fetch("/api/pipeline/outcomes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entryId, performance }),
        });
        // `code`, never `error`: the server's English is canonical for the log and
        // for API consumers, and useErrorMessage resolves the code through the
        // `errors` catalog in the reader's language (app/_lib/use-error-message.ts).
        const payload = (await res.json()) as { ok?: boolean; code?: string | null };
        if (!res.ok || !payload.ok) {
          setFailed(errorMessage(payload, t("saveFailed")));
          return;
        }
        // Reflect what the server accepted, and stamp the time it was accepted —
        // never an optimistic value written before the write landed.
        setView((cur) => (cur ? { ...cur, performance, recordedAt: new Date().toISOString() } : cur));
      } catch {
        setFailed(t("saveFailed"));
      } finally {
        setSaving(false);
      }
    },
    [entryId]
  );

  if (!view || !view.hired) return null;

  const levels = Array.from({ length: view.max - view.min + 1 }, (_, i) => view.min + i);
  const recordedOn = view.recordedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(view.recordedAt))
    : null;

  return (
    <div className="rounded-md border border-stone-200 bg-white p-3">
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <Sprout size={13} aria-hidden /> {t("title")}
      </p>

      <p className="mt-1 text-sm text-ink">
        {view.performance != null && recordedOn
          ? t("rated", { rating: view.performance, max: view.max, date: recordedOn })
          : t("unrated")}
      </p>

      <div className={`${TOGGLE_GROUP} mt-2`} role="group" aria-label={t("title")}>
        {levels.map((n) => (
          <button
            key={n}
            type="button"
            disabled={saving}
            aria-pressed={view.performance === n}
            aria-label={t("rateAria", { n, max: view.max })}
            onClick={() => void rate(n)}
            className={`focus-ring rounded px-2.5 py-1 text-sm font-semibold nums transition-colors disabled:opacity-60 ${toggleBtn(view.performance === n)}`}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="mt-1 text-meta text-steel">{t("scaleHint")}</p>

      {saving ? <p className="mt-1.5 text-meta text-steel">{t("saving")}</p> : null}
      {failed ? (
        <p role="alert" className="mt-1.5 text-sm text-red-700">
          {failed}
        </p>
      ) : null}

      {/* Said plainly, at the moment of entry: what the rating is for, and that
          nothing automated acts on it. The studio does not collect a judgement
          about a person without stating why it is being asked for. */}
      <p className="mt-1.5 text-meta leading-relaxed text-steel">{t("purpose")}</p>
      <p className="mt-1 text-meta leading-relaxed text-steel">{t("notAutomated")}</p>
    </div>
  );
}
