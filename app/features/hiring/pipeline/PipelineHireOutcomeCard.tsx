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

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sprout } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { BTN_SECONDARY, TOGGLE_GROUP, toggleBtn } from "@/app/_components/ui/recipes";

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
  // drawer-cards-hold-the-chip-law — the READ's own give-up, and the retry that
  // makes it recoverable. a bare discarding catch used to swallow it, and since
  // a null `view` returns null one screen down, a transient blip made the
  // quality-of-hire card VANISH for a real hire with nothing to press: the surface
  // that asks "did this hire work out?" silently claimed there was nothing to ask.
  // This is the hole ConsentPanel's `loadFailed` closed one card over, so it is
  // closed the same way — a stated failure with a way out, never a blank space.
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  // Its own small read, fired ONLY for a hire — the drawer's one-call bundle stays
  // one call for every other candidate, which is the deliberate property the bundle
  // exists for.
  useEffect(() => {
    let live = true;
    fetch(`/api/pipeline/outcomes?entry=${encodeURIComponent(entryId)}`)
      .then((r) => r.json())
      .then((p) => {
        if (!live) return;
        if (p.error) throw new Error(p.error);
        setView(p as HireOutcomeView);
        // Clears a prior give-up on a retry — and on an entryId change, since this
        // card is not remounted per candidate. Set from the resolved read, never
        // synchronously in the effect body (that is a cascading render).
        setLoadFailed(false);
      })
      .catch(() => {
        // Not silent: a give-up the recruiter can see and re-run. The raw reason
        // stays off the surface (it is a network/store accident, not a decision).
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, [entryId, reloadTick]);

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
    // `errorMessage` and `t` are read inside, so they belong here: a deps array
    // that names only `entryId` pins the FIRST render's locale bindings, and a
    // reader who switches language keeps getting the previous language's refusal.
    [entryId, errorMessage, t]
  );

  // A day-formatter per card, not one per render: this component re-renders on
  // every rating press and `Intl.DateTimeFormat` construction is the expensive
  // half of the call.
  const dayFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale]);

  // The read failed → say so, with the retry. Before `hired` is known, because a
  // failed read knows nothing about this candidate; the drawer only mounts this
  // card on the terminal-role stage, so the frame is honest either way.
  if (loadFailed) {
    return (
      <div className="rounded-md border border-stone-200 bg-white p-3">
        <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
          <Sprout size={13} aria-hidden /> {t("title")}
        </p>
        <p className="mt-1 text-sm text-steel">{t("loadFailed")}</p>
        <button
          type="button"
          onClick={() => {
            setLoadFailed(false);
            setReloadTick((n) => n + 1);
          }}
          className={`${BTN_SECONDARY} mt-2 h-8 px-2.5 text-sm`}
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  if (!view || !view.hired) return null;

  const levels = Array.from({ length: view.max - view.min + 1 }, (_, i) => view.min + i);
  const recordedOn = view.recordedAt ? dayFormat.format(new Date(view.recordedAt)) : null;

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
