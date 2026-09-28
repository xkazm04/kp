"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Tooltip } from "@/app/_components/Tooltip";
import { GIG_ARENAS, type Gig, type GigAttempt, type GigKpi, type GigKpiCell } from "@/app/_lib/gigs/types";
import { foldNiches, nicheCell, programTally, type AttemptTally } from "./deskLogic";
import { overallCell, rateView, type SpecialistRow } from "./gigsLogic";
import { markForGig, OutcomeMark } from "./GigsMarks";
import { useGigsFormat } from "./useGigsFormat";

// Reception - where the outside judges' verdicts land, and the one number the desk answers
// to (B/3 "The Proof", kept by the owner's verdict on the gigs-calm contest). The rate is
// said ONCE, as a sentence; every arena and specialist below it is either a measured
// fraction with its n or a dashed "not zero" stub - never a 0% bar. An empty ledger is one
// line, not a table of ghost rows. Money stays in the currency it was paid in and is never
// added up; an unreported cost is a count, never folded in as free.

/** Attempt statuses in the order the stack is drawn: the ones that cost a round first. */
const STACK_ORDER = ["revision_requested", "failed", "drafted", "approved", "sent", "running", "dispatched", "discarded"] as const;

export function GigsReception({
  gigs,
  attemptsByGig,
  specialists,
  tallies,
  kpi,
  onOpenGig,
}: {
  gigs: readonly Gig[];
  attemptsByGig: Readonly<Record<string, GigAttempt>>;
  specialists: readonly SpecialistRow[];
  tallies: Readonly<Record<string, AttemptTally>> | null;
  kpi: GigKpi | null;
  /** Open a gig's proof; `ids` is the list ←/→ walks, `label` names it in the trail. */
  onOpenGig: (gigId: string, ids: string[], label: string) => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();

  // The verdicts that came back, newest first: a sent attempt whose gig moved on to a
  // verdict (expired = the operator stopped waiting, drawn as "no response").
  const ledger = useMemo(
    () =>
      gigs
        .map((g) => ({ g, a: attemptsByGig[g.id] ?? null }))
        .filter((x) => x.a?.status === "sent" && (x.g.status === "accepted" || x.g.status === "rejected" || x.g.status === "expired"))
        .sort((x, y) => (x.g.updatedAt < y.g.updatedAt ? 1 : x.g.updatedAt > y.g.updatedAt ? -1 : 0)),
    [gigs, attemptsByGig]
  );
  const sent = useMemo(() => gigs.filter((g) => attemptsByGig[g.id]?.status === "sent").length, [gigs, attemptsByGig]);
  const listings = useMemo(() => {
    const out: Record<string, number> = {};
    for (const g of gigs) out[g.arena] = (out[g.arena] ?? 0) + 1;
    return out;
  }, [gigs]);
  const niches = useMemo(() => foldNiches(specialists), [specialists]);
  const program = useMemo(() => programTally(tallies), [tallies]);

  if (!kpi) return <p className="t-meta">{t("reception.loading")}</p>;

  const overall = overallCell(kpi);
  const ledgerIds = ledger.map((x) => x.g.id);
  const stack = STACK_ORDER.map((s) => ({ s, n: program.byStatus[s] ?? 0 })).filter((x) => x.n > 0);
  const stackSpoken = stack.map((x) => `${x.n} ${fmt.attemptStatus(x.s)}`).join(", ");

  return (
    <div className="enter">
      <header className="page-head">
        <span className="caps dim">{t("reception.caps")}</span>
        <h2 className="t-display">{t("reception.headline", { sent, resolved: overall.resolved })}</h2>
        <p className="deck">{t("reception.deck")}</p>
      </header>

      <div className="reception">
        <div>
          <section className="ledger" aria-label={t("reception.ledgerLabel")}>
            {ledger.length === 0 ? (
              <p className="first">{t("reception.ledgerEmpty")}</p>
            ) : (
              <>
                <div className="lh" aria-hidden>
                  <span>{t("reception.colDate")}</span>
                  <span>{t("reception.colGig")}</span>
                  <span>{t("reception.colVerdict")}</span>
                </div>
                <ul className="lrows">
                  {ledger.map(({ g, a }) => {
                    const mark = markForGig(g, a);
                    return (
                      <li key={g.id} className="lr">
                        <span className="t-meta">{fmt.date(g.updatedAt)}</span>
                        <button type="button" onClick={() => onOpenGig(g.id, ledgerIds, t("reception.caps"))}>
                          {g.title}
                        </button>
                        <span className="inline-flex items-center gap-1.5">
                          {mark ? <OutcomeMark kind={mark} /> : null}
                          {mark ? t(`mark.${mark}` as Parameters<typeof t>[0]) : fmt.status(g.status)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>

          <div className="stubs" aria-label={t("reception.stubsLabel")}>
            <div className="sh">
              <span className="caps dim">{t("reception.byArena")}</span>
              <span className="caps dim">{t("reception.colRatio")}</span>
              <span className="caps dim r">
                {t("reception.colRate")}
              </span>
            </div>
            {GIG_ARENAS.map((a) => (
              <StubRow key={a} name={fmt.arena(a)} sub={t("reception.listings", { count: listings[a] ?? 0 })} cell={kpi.byArena[a]} />
            ))}
            <div className="sh next">
              <span className="caps dim">{t("reception.bySpecialist")}</span>
              <span className="caps dim">{t("reception.colRatio")}</span>
              <span className="caps dim r">
                {t("reception.colRate")}
              </span>
            </div>
            {niches.length === 0 ? (
              <p className="q-empty">{t("reception.noSpecialists")}</p>
            ) : (
              niches.map((n) => (
                <StubRow
                  key={n.key}
                  name={n.label.charAt(0).toUpperCase() + n.label.slice(1)}
                  sub={n.hires.length > 1 ? `${fmt.arena(n.arena)} · ${t("reception.hires", { count: n.hires.length })}` : fmt.arena(n.arena)}
                  cell={nicheCell(n, kpi)}
                />
              ))
            )}
          </div>
        </div>

        <div className="known" aria-label={t("reception.knownLabel")}>
          <div className="k">
            <span className="caps dim">{t("reception.attempts")}</span>
            <span className="fig">{program.attempts}</span>
            {program.attempts === 0 ? (
              <span className="t-meta">{t("reception.noAttempts")}</span>
            ) : (
              <>
                <div className="stack" role="img" aria-label={t("reception.stackLabel", { list: stackSpoken })}>
                  {stack.map((x) => (
                    <i key={x.s} className={`s-${x.s}`} style={{ flex: x.n }} />
                  ))}
                </div>
                <div className="legend">
                  {stack.map((x) => (
                    <span key={x.s}>
                      <i className={`s-${x.s}`} aria-hidden />
                      <b>{x.n}</b> {fmt.attemptStatus(x.s).toLowerCase()}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="k">
            <span className="caps dim">{t("reception.cost")}</span>
            <span className="fig">{fmt.usd(program.costUsd)}</span>
            <span className="t-meta">{program.costUnreported > 0 ? t("reception.costLowerBound", { count: program.costUnreported }) : t("reception.costAll")}</span>
          </div>

          <div className="k">
            <span className="caps dim">{t("reception.money")}</span>
            {kpi.moneyWon.length === 0 ? (
              <>
                <span className="fig words dash">{t("reception.noneRecorded")}</span>
                <span className="t-meta">{t("reception.moneyRule")}</span>
              </>
            ) : (
              <>
                {kpi.moneyWon.map((m) => (
                  <span key={m.currency ?? "none"} className="flex items-baseline justify-between gap-3">
                    <span className="fig words">{fmt.money(m.amount, m.currency)}</span>
                    <span className="t-meta">{t("scorecard.moneyCount", { count: m.count })}</span>
                  </span>
                ))}
                <span className="t-meta">{t("scorecard.noTotal")}</span>
              </>
            )}
            {kpi.acceptedWithoutAmount > 0 ? <span className="t-meta">{t("scorecard.acceptedNoAmount", { count: kpi.acceptedWithoutAmount })}</span> : null}
          </div>

          <div className="k">
            <span className="caps dim">{t("reception.sent")}</span>
            <span className="fig">{sent}</span>
            <span className="t-meta">{sent === 0 ? t("reception.sentZero") : t("reception.sentSome", { pending: overall.pending })}</span>
          </div>

          <div className="k">
            <span className="caps dim">{t("reception.disclosure")}</span>
            {kpi.disclosureRate === null ? (
              <>
                <span className="fig dash" aria-label={t("reception.disclosureNone")}>
                  —
                </span>
                <span className="t-meta">{t("reception.disclosureNone")}</span>
              </>
            ) : (
              <>
                <span className="fig">{fmt.percent(Math.round(kpi.disclosureRate * 100))}</span>
                <span className="t-meta">{t("scorecard.disclosureNote")}</span>
              </>
            )}
          </div>

          <p className="t-meta computed">
            {t("scorecard.computedAt", { date: fmt.dateTime(kpi.computedAt) })}
          </p>
        </div>
      </div>
    </div>
  );
}

/** One arena or specialist: a measured fraction with its n, or a dashed stub that says
 *  "not zero" - an unmeasured rate is never drawn as an empty bar. Pending rides beside. */
function StubRow({ name, sub, cell }: { name: string; sub: string; cell: GigKpiCell | undefined }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const r = rateView(cell);
  const said = r.measured
    ? t("reception.measuredTip", { name, accepted: r.accepted, resolved: r.resolved })
    : t("reception.unmeasuredTip", { name });
  return (
    <div className="sr2">
      <span>
        <span className="nm">{name}</span> <span className="t-meta">{sub}</span>
        {r.pending > 0 ? <span className="t-meta"> · {t("rate.pending", { count: r.pending })}</span> : null}
      </span>
      <Tooltip label={said} className="stubtip">
        {r.measured ? (
          <span className="bar measured" tabIndex={0} role="img" aria-label={said}>
            <i style={{ width: `${r.percent ?? 0}%` }} />
          </span>
        ) : (
          <span className="bar" tabIndex={0} role="img" aria-label={said}>
            <span aria-hidden>{t("reception.notZero")}</span>
          </span>
        )}
      </Tooltip>
      <span className={`rate${r.measured ? " measured" : ""}`}>
        {r.measured ? (
          <>
            {fmt.percent(r.percent ?? 0)}
            <span className="t-meta sub">
              {t("rate.fraction", { accepted: r.accepted, resolved: r.resolved })}
              {r.small ? ` · ${t("reception.small")}` : null}
            </span>
          </>
        ) : (
          <span aria-hidden>—</span>
        )}
      </span>
    </div>
  );
}
