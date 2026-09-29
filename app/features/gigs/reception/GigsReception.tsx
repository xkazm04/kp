"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Gig, GigAttempt, GigKpi } from "@/app/_lib/gigs/types";
import { type AttemptTally, foldNiches, programTally } from "../logic/niches";
import { overallCell } from "../logic/rate";
import type { SpecialistRow } from "../logic/wire";
import { markForGig, OutcomeMark } from "../shared/GigsMarks";
import { useGigsFormat } from "../data/useGigsFormat";
import { ReceptionKnown } from "./ReceptionKnown";
import { ReceptionStubs } from "./ReceptionStubs";

// Reception - where the outside judges' verdicts land, and the one number the desk answers
// to (B/3 "The Proof", kept by the owner's verdict on the gigs-calm contest). The rate is
// said ONCE, as a sentence; every arena and specialist below it is either a measured
// fraction with its n or a dashed "not zero" stub - never a 0% bar. An empty ledger is one
// line, not a table of ghost rows. Money stays in the currency it was paid in and is never
// added up; an unreported cost is a count, never folded in as free.
//
// Files: this page (the head and the verdict ledger); ReceptionStubs.tsx (the rate by
// arena and by specialist); ReceptionKnown.tsx (attempts, cost, money, sent, disclosure).

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

          <ReceptionStubs kpi={kpi} listings={listings} niches={niches} />
        </div>

        <ReceptionKnown kpi={kpi} program={program} sent={sent} overall={overall} />
      </div>
    </div>
  );
}
