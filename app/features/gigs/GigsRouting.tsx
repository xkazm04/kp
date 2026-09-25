"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Meter } from "@/app/_components/Meter";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CHIP_QUIET, FIELD, META_LABEL, NOTICE, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { scoreTone } from "@/app/_lib/format";
import type { GigMatchReason } from "@/app/_lib/gigs/match";
import type { Gig, GigKpi } from "@/app/_lib/gigs/types";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { AfterWrite, SpecialistRow } from "./gigsLogic";
import { Absent } from "./GigsFacts";
import { routingView, type RankedCandidate } from "./routingView";
import { sendJson } from "./useGigsData";
import { useGigsFormat } from "./useGigsFormat";

// The gig's Match panel (docs/features/gigs/README.md "Matchmaking and routing"), under the
// workspace row: who the gig goes to now and whether the operator routed it or the matcher
// picked it; every specialist in the arena ranked by the matcher (app/_lib/gigs/match.ts -
// the same function the qualifier runs), each with its fit as a labelled bar AND the number
// in words, and its reasons as text; "Route here" on each ready one, "Auto-match" to hand
// the choice back; and, when nothing fits and is ready, a hire for the suggested niche
// (editable) through the Specialists page's own door, POST /api/gigs/specialists.
// While a run holds the specialist (dispatched), a suspect gig, or a gig off the line, the
// buttons are gone and a sentence says why.

export function GigsRouting({
  gig,
  specialists,
  kpi,
  onChanged,
}: {
  gig: Gig;
  specialists: readonly SpecialistRow[];
  kpi: GigKpi | null;
  onChanged: AfterWrite;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const view = useMemo(() => routingView(gig, specialists, kpi), [gig, specialists, kpi]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function patch(body: { action: "route"; specialistId: string } | { action: "unroute" }, flash: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await sendJson(`/api/gigs/${encodeURIComponent(gig.id)}`, "PATCH", body);
    setBusy(false);
    if (!res.ok) {
      setError(resolveError(res.body as ApiErrorPayload | null, t("routing.failed")));
      return;
    }
    setDone(flash);
    await onChanged(null);
  }

  const arena = fmt.arena(gig.arena);
  const lockText = view.lock ? t(`routing.locked.${view.lock}`) : null;

  return (
    <section aria-labelledby={`routing-${gig.id}`} className={`${PANEL_SUNKEN} space-y-3 px-4 py-3 text-sm`}>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <h3 id={`routing-${gig.id}`} className={META_LABEL}>
          {t("routing.title")}
        </h3>
        <p className="text-steel">
          {t("routing.goesTo")}:{" "}
          {view.current ? (
            <>
              <span className="font-semibold text-ink">{view.current.name}</span>
              <span className="text-steel"> · {view.current.spec.niche} · </span>
              <span className={CHIP_QUIET}>{view.routed ? t("routing.routedByYou") : t("routing.autoMatched")}</span>
            </>
          ) : (
            <Absent>{t("routing.noneMatched")}</Absent>
          )}
        </p>
        {view.routed && !view.lock ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void patch({ action: "unroute" }, t("routing.unroutedFlash"))}
            className={`${BTN_GHOST} h-8 px-3 text-sm`}
            aria-describedby={`routing-auto-${gig.id}`}
          >
            {t("routing.autoMatch")}
          </button>
        ) : null}
      </div>
      <p className="max-w-3xl text-steel">{t("routing.lede")}</p>
      {view.routed && !view.lock ? (
        <p id={`routing-auto-${gig.id}`} className="text-steel">
          {t("routing.autoMatchHint")}
        </p>
      ) : null}
      {lockText ? <p className={`${NOTICE("info")} px-3 py-2`}>{lockText}</p> : null}

      {view.ranked.length === 0 ? (
        <p className="text-steel">{t("routing.noCandidates", { arena })}</p>
      ) : (
        <div className="space-y-1">
          <p className={META_LABEL}>{t("routing.candidates", { count: view.ranked.length, arena })}</p>
          <ol className="divide-y divide-dotted divide-stone-200">
            {view.ranked.map((c) => (
              <Candidate
                key={c.specialistId}
                c={c}
                isCurrent={c.specialistId === view.current?.id}
                canRoute={!view.lock && !busy}
                onRoute={() => void patch({ action: "route", specialistId: c.specialistId }, t("routing.routedFlash", { name: c.specialist.name }))}
              />
            ))}
          </ol>
        </div>
      )}

      {view.noFit && !view.lock ? <HireForNiche key={gig.id} gig={gig} suggested={view.suggestedNiche} onChanged={onChanged} /> : null}

      {busy ? (
        <p role="status" className="text-steel">
          {t("routing.working")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={`${NOTICE("critical")} px-3 py-2`}>
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className={`${NOTICE("info")} px-3 py-2`}>
          {done}
        </p>
      ) : null}
    </section>
  );
}

function Candidate({ c, isCurrent, canRoute, onRoute }: { c: RankedCandidate; isCurrent: boolean; canRoute: boolean; onRoute: () => void }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const status = c.specialist.hire?.status ?? null;
  return (
    <li className="grid gap-x-4 gap-y-1.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-start">
      <div className="min-w-0">
        <p className="font-semibold text-ink">
          {c.specialist.name}
          {isCurrent ? <span className={`${CHIP_QUIET} ml-2`}>{t("routing.current")}</span> : null}
        </p>
        <p className="text-steel">{c.specialist.spec.niche}</p>
        <ul className="mt-1 space-y-0.5 text-steel">
          {c.reasons
            .filter((r) => r.code !== "hire_not_ready" && r.code !== "no_hire")
            .map((r, i) => (
              <li key={`${r.code}-${i}`}>{reasonText(t, r)}</li>
            ))}
        </ul>
      </div>
      <div className="space-y-1">
        <p className="text-ink nums">{t("routing.fit", { score: c.score })}</p>
        <Meter value={c.score} tone={scoreTone(c.score)} aria-label={t("routing.fitLabel", { name: c.specialist.name, score: c.score })} />
        <p className={c.ready ? "text-ink" : "text-steel"}>
          {c.ready ? t("routing.ready") : t("routing.notReady", { status: status ? fmt.hireStatus(status) : t("routing.reason.no_hire") })}
        </p>
      </div>
      <div className="sm:text-right">
        {c.ready && !isCurrent ? (
          <button type="button" disabled={!canRoute} onClick={onRoute} className={`${BTN_SECONDARY} h-8 px-3 text-sm`}>
            {t("routing.routeHere")}
          </button>
        ) : null}
      </div>
    </li>
  );
}

type Translate = ReturnType<typeof useTranslations<"gigs">>;

/** One reason in words. The readiness reasons (hire_not_ready, no_hire) are not listed:
 *  the candidate's readiness line already says them, with the hire status translated. */
function reasonText(t: Translate, r: GigMatchReason): string {
  return t(`routing.reason.${r.code}`, { evidence: r.evidence ?? "" });
}

function HireForNiche({ gig, suggested, onChanged }: { gig: Gig; suggested: string | null; onChanged: AfterWrite }) {
  const t = useTranslations("gigs");
  const resolveError = useErrorMessage();
  const [niche, setNiche] = useState(suggested ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function hire() {
    if (busy) return;
    if (!niche.trim()) {
      setError(t("routing.nicheRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await sendJson("/api/gigs/specialists", "POST", { arena: gig.arena, niche: niche.trim() });
    setBusy(false);
    if (!res.ok) {
      setError(resolveError(res.body as ApiErrorPayload | null, t("routing.hireFailed")));
      return;
    }
    setDone(res.body?.reused === true ? t("routing.reused") : t("routing.hired"));
    await onChanged(null);
  }

  return (
    <form
      className={`${NOTICE("amber")} flex flex-wrap items-end gap-3 px-3 py-2.5`}
      onSubmit={(e) => {
        e.preventDefault();
        void hire();
      }}
    >
      <div className="basis-full">
        <p className="font-semibold">{t("routing.noFitTitle")}</p>
        <p>{t("routing.noFitBody")}</p>
      </div>
      <label className="min-w-[14rem] flex-1">
        <span className="block font-semibold">{t("routing.nicheLabel")}</span>
        <input value={niche} onChange={(e) => setNiche(e.target.value)} maxLength={80} className={`${FIELD} mt-1 w-full`} />
      </label>
      <button type="submit" disabled={busy} className={`${BTN_PRIMARY} h-10 px-4 text-sm`}>
        {t("routing.hire")}
      </button>
      {busy ? (
        <p role="status" className="basis-full">
          {t("routing.hiring")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={`${NOTICE("critical")} basis-full px-3 py-2`}>
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="basis-full">
          {done}
        </p>
      ) : null}
    </form>
  );
}
