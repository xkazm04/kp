"use client";

import { useTranslations } from "next-intl";
import { CHIP_QUIET, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { GIG_ARENAS, type Gig, type GigAttempt, type GigKpi, type GigKpiCell } from "@/app/_lib/gigs/types";
import { overallCell, rateView, type SpecialistRow } from "./gigsLogic";
import { markForGig, MarkRow, type MarkKind } from "./GigsMarks";
import { useGigsFormat } from "./useGigsFormat";

// The scorecard rail - visible on every screen of the tab (the Bench borrowing). The
// rate is ALWAYS a fraction first ("3 of 7"), the percentage only beside its n, pending
// counted apart and never folded in, a small sample flagged as one, and money kept per
// currency and never summed. It reads the server's own fold (GET /api/gigs/kpi), which
// the tab re-reads after every outcome it records, so the rail re-derives on each verdict.

export function RateLine({ cell, compact = false }: { cell: GigKpiCell | null | undefined; compact?: boolean }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const r = rateView(cell);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5 nums">
      {r.measured ? (
        <>
          <span className="font-semibold text-ink">{t("rate.fraction", { accepted: r.accepted, resolved: r.resolved })}</span>
          {compact ? null : <span className="text-sm text-steel">{t("rate.percentAtN", { percent: fmt.percent(r.percent ?? 0), n: r.resolved })}</span>}
        </>
      ) : (
        <span className="text-sm italic text-steel">{t("rate.unmeasured")}</span>
      )}
      <span className="text-sm text-steel">{t("rate.pending", { count: r.pending })}</span>
      {r.measured && r.small ? <span className={`${CHIP_QUIET} text-xs`}>{t("rate.small")}</span> : null}
    </span>
  );
}

/** Marks for every gig whose latest attempt was sent, oldest sent first. */
export function sentMarks(gigs: readonly Gig[], attemptsByGig: Readonly<Record<string, GigAttempt>>, filter?: (g: Gig, a: GigAttempt) => boolean): MarkKind[] {
  return gigs
    .map((g) => ({ g, a: attemptsByGig[g.id] ?? null }))
    .filter((x): x is { g: Gig; a: GigAttempt } => x.a !== null && x.a.status === "sent" && (!filter || filter(x.g, x.a)))
    .sort((x, y) => ((x.a.sentAt ?? "") < (y.a.sentAt ?? "") ? -1 : 1))
    .map((x) => markForGig(x.g, x.a))
    .filter((m): m is MarkKind => m !== null);
}

export function GigsScoreRail({
  kpi,
  gigs,
  attemptsByGig,
  specialists,
}: {
  kpi: GigKpi | null;
  gigs: readonly Gig[] | null;
  attemptsByGig: Readonly<Record<string, GigAttempt>>;
  specialists: readonly SpecialistRow[] | null;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  if (!kpi) {
    return (
      <aside className={`${PANEL} p-4`} aria-label={t("rail.label")}>
        <p className={META_LABEL}>{t("rail.title")}</p>
        <p className="mt-2 text-sm text-steel">{t("rail.loading")}</p>
      </aside>
    );
  }
  const overall = overallCell(kpi);
  const r = rateView(overall);
  const marks = gigs ? sentMarks(gigs, attemptsByGig) : [];
  const specialistRows = (specialists ?? []).map((s) => ({ s, cell: kpi.bySpecialist[s.id] }));

  return (
    <aside className={`${PANEL} grid gap-5 p-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-1`} aria-label={t("rail.label")}>
      <section>
        <h2 className={META_LABEL}>{t("rail.title")}</h2>
        <p className="mt-2 font-serif text-h2 leading-none text-ink nums">
          {r.measured ? t("rate.fraction", { accepted: r.accepted, resolved: r.resolved }) : t("rate.unmeasuredShort")}
        </p>
        <p className="mt-1 text-sm text-steel nums">
          {r.measured ? t("rail.resolvedLine", { percent: fmt.percent(r.percent ?? 0), n: r.resolved }) : t("rail.nothingResolved")}
        </p>
        <p className="mt-1 text-sm text-steel nums">{t("rate.pending", { count: r.pending })}</p>
        {r.small ? <span className={`${CHIP_QUIET} mt-2 text-xs`}>{t("rate.small")}</span> : null}
        <div className="mt-3">
          <MarkRow marks={marks} emptyLabel={t("rail.nothingSent")} />
        </div>
      </section>

      <section>
        <h2 className={META_LABEL}>{t("rail.byArena")}</h2>
        <ul className="mt-2 space-y-2">
          {GIG_ARENAS.map((a) => (
            <li key={a}>
              <p className="text-sm font-semibold text-ink">{fmt.arena(a)}</p>
              <RateLine cell={kpi.byArena[a]} compact />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className={META_LABEL}>{t("rail.bySpecialist")}</h2>
        {specialistRows.length === 0 ? (
          <p className="mt-2 text-sm text-steel">{t("rail.noSpecialists")}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {specialistRows.map(({ s, cell }) => (
              <li key={s.id}>
                <p className="text-sm font-semibold text-ink">{s.name}</p>
                <RateLine cell={cell} compact />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className={META_LABEL}>{t("rail.moneyWon")}</h2>
        {kpi.moneyWon.length === 0 ? (
          <p className="mt-2 text-sm text-steel">{t("rail.noMoney")}</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {kpi.moneyWon.map((m) => (
              <li key={m.currency ?? "none"} className="flex items-baseline justify-between gap-3 nums">
                <span className="font-semibold text-ink">{fmt.money(m.amount, m.currency)}</span>
                <span className="text-sm text-steel">{t("rail.moneyCount", { count: m.count })}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-sm text-steel">{t("rail.neverSummed")}</p>
        {kpi.acceptedWithoutAmount > 0 ? <p className="mt-1 text-sm text-steel">{t("rail.acceptedNoAmount", { count: kpi.acceptedWithoutAmount })}</p> : null}
        <p className="mt-3 text-sm text-steel">
          {kpi.disclosureRate === null ? t("rail.disclosureNone") : t("rail.disclosure", { percent: fmt.percent(Math.round(kpi.disclosureRate * 100)) })}
        </p>
      </section>
    </aside>
  );
}
