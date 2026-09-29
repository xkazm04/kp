"use client";

import { useTranslations } from "next-intl";
import { Tooltip } from "@/app/_components/Tooltip";
import { GIG_ARENAS, type GigKpi, type GigKpiCell } from "@/app/_lib/gigs/types";
import { nicheCell, type Niche } from "../logic/niches";
import { rateView } from "../logic/rate";
import { useGigsFormat } from "../data/useGigsFormat";

/** The rate by arena, then by specialist niche: one stub row each, under the ledger. */
export function ReceptionStubs({ kpi, listings, niches }: { kpi: GigKpi; listings: Readonly<Record<string, number>>; niches: readonly Niche[] }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  return (
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
