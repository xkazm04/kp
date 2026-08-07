"use client";

/*
 * Shared Market Pulse building blocks — the data-viz vocabulary both the Atlas
 * and Board variants compose from. All Spark art direction (literal hexes, the
 * docs/design/README.md exemption). Every user-facing string resolves through the
 * `jobMarket` i18n namespace; region/occupation/employer names come straight
 * from the (Czech) source data.
 *
 * Every block here carries ART_TYPE_SCALE on its root: these are the page's
 * data cards, drawn at product-UI sizes, and this file is the boundary between
 * them and the editorial copy around them (hero, section heads, footer), which
 * stays on the page-level TYPE_SCALE. See app/globals.css for the two scales.
 */
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ART_TYPE_SCALE, DISPLAY, HAND, STICKER, INK, CORAL, MOSS } from "../tokens";
import {
  fmtCzk,
  fmtCzkShort,
  fmtInt,
  fmtDate,
  isFigure,
  heatColor,
  salaryColor,
  type MapMetric,
  type Region,
  type OrgType,
  type FamilyDemand,
  type Occupation,
  type RefSalary,
  type JdGroup,
} from "./data";
import { familyColor, orgColor } from "./marketColors";

// ── stat tile ────────────────────────────────────────────────────────────────
export function StatTile({ value, label, hint, tilt = 0 }: { value: string; label: string; hint?: string; tilt?: number }) {
  return (
    <div className={`${ART_TYPE_SCALE} ${STICKER} px-5 py-4`} style={{ transform: `rotate(${tilt}deg)` }}>
      <div className={`${DISPLAY} text-3xl font-extrabold leading-none sm:text-4xl`}>{value}</div>
      <div className="mt-1.5 text-[17px] font-bold uppercase tracking-wide text-[#42606f]">{label}</div>
      {hint ? <div className={`${HAND} mt-0.5 text-sm text-[#526b4f]`}>{hint}</div> : null}
    </div>
  );
}

// ── map metric toggle (shared-layout pill, reduced-motion gated) ──────────────
export function MetricToggle({ metric, onChange }: { metric: MapMetric; onChange: (m: MapMetric) => void }) {
  const t = useTranslations("jobMarket");
  const reduce = useReducedMotion();
  const opts: { key: MapMetric; label: string }[] = [
    { key: "volume", label: t("map.metricVolume") },
    { key: "salary", label: t("map.metricSalary") },
  ];
  return (
    <div className={`${ART_TYPE_SCALE} inline-flex rounded-xl border-[3px] border-[#17202a] bg-white p-1 shadow-[3px_3px_0_#17202a]`}>
      {opts.map((o) => {
        const active = metric === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className="relative rounded-lg px-4 py-1.5 text-sm font-bold transition-colors"
            style={{ color: active ? "#fdf8ee" : INK }}
          >
            {active && (
              <motion.span
                layoutId={reduce ? undefined : "mapMetricPill"}
                className="absolute inset-0 rounded-lg"
                style={{ background: INK }}
                transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── map legend ────────────────────────────────────────────────────────────────
// The choropleth encodes value as fill colour; the legend is how a reader maps a
// mid-tone back to an approximate figure. It shows THREE labelled ticks (lo · mid
// · hi) so the scale reads without hovering, and the whole widget is a single
// `role="img"` whose localised `aria-label` states the full scale — so AT users
// (for whom the gradient is decorative/aria-hidden) still get the range, not
// silence.
export function MapLegend({ metric, lo, mid, hi }: { metric: MapMetric; lo: string; mid: string; hi: string }) {
  const t = useTranslations("jobMarket");
  const desc = metric === "volume" ? t("map.legendVolume") : t("map.legendSalary");
  const stops =
    metric === "volume"
      ? [heatColor(0), heatColor(0.5), heatColor(1)]
      : [salaryColor(0.05), salaryColor(0.5), salaryColor(1)];
  return (
    <div
      role="img"
      aria-label={t("map.legendScale", { desc, lo, mid, hi })}
      className={`${ART_TYPE_SCALE} flex items-center gap-3`}
    >
      {/* Visual scale — decorative for AT (the aria-label above carries it).
          The track is sized off the three tick labels, not the other way round:
          at the card text size they are ~45px each, so a narrower bar would
          run them into one another. */}
      <div className="flex flex-col gap-1" aria-hidden>
        <span
          className="h-3 w-48 rounded-full border-[2px] border-[#17202a]"
          style={{ background: `linear-gradient(90deg, ${stops[0]}, ${stops[1]}, ${stops[2]})` }}
        />
        <span className="flex w-48 justify-between gap-1 text-[15px] font-bold text-[#42606f]">
          <span>{lo}</span>
          <span>{mid}</span>
          <span>{hi}</span>
        </span>
      </div>
      <span className={`${HAND} text-sm text-[#526b4f]`} aria-hidden>
        {desc}
      </span>
    </div>
  );
}

// ── region detail card (reacts to the active map region) ──────────────────────
// Renders in place with a reserved min-height so switching the active region
// only swaps text — it never remounts or reflows the surrounding layout.
export function RegionDetail({ region }: { region: Region | null }) {
  const t = useTranslations("jobMarket");
  return (
    // A polite live region: because activating a map region only swaps this
    // card's text (no remount), a screen reader would otherwise never hear the
    // change — role="status"/aria-live announces the newly selected region's
    // figures. aria-atomic re-reads the whole card so name + values stay together.
    <div
      className={`${ART_TYPE_SCALE} ${STICKER} min-h-[212px] px-6 py-5`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {!region ? (
        <div className="flex h-full min-h-[172px] flex-col items-center justify-center text-center">
          <p className={`${HAND} text-lg text-[#526b4f]`}>{t("map.hintTitle")}</p>
          <p className="mt-1 text-[19px] text-[#42606f]">{t("map.hintBody")}</p>
        </div>
      ) : (
        <>
          <p className={`${HAND} text-sm text-[#526b4f]`}>{region.code}</p>
          <h3 className={`${DISPLAY} text-2xl font-extrabold`}>{region.name}</h3>
          {/* No survey median for this region → drop the tile and let the
              vacancy count take the full width, rather than printing an
              em-dash under a "Median salary" label. */}
          <div className={`mt-4 grid gap-4 ${isFigure(region.medianSalary) ? "grid-cols-2" : "grid-cols-1"}`}>
            <div>
              <div className={`${DISPLAY} text-2xl font-extrabold text-[#d65a4a]`}>{fmtInt(region.vacancies)}</div>
              <div className="text-[16px] font-bold uppercase tracking-wide text-[#42606f]">{t("map.vacancies")}</div>
            </div>
            {isFigure(region.medianSalary) ? (
              <div>
                <div className={`${DISPLAY} text-2xl font-extrabold text-[#526b4f]`}>{fmtCzk(region.medianSalary)}</div>
                <div className="text-[16px] font-bold uppercase tracking-wide text-[#42606f]">{t("map.median")}</div>
              </div>
            ) : null}
          </div>
          {isFigure(region.p25) && isFigure(region.p75) ? (
            <p className={`${HAND} mt-3 text-sm text-[#526b4f]`}>
              {t("map.range", { lo: fmtCzkShort(region.p25), hi: fmtCzkShort(region.p75) })}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

// ── salary bands (families × seniority as range bars off ISPV deciles) ────────
export function SalaryBands({ families }: { families: RefSalary[] }) {
  const t = useTranslations("jobMarket");
  // A family with no median has no band to draw — and `pos(null) → 0` would
  // have drawn one starting at 0 Kč. Drop the row instead.
  const rows = families.filter((f) => isFigure(f.median));
  const max = Math.max(...rows.map((f) => (isFigure(f.lead) ? f.lead : 0)), 0) * 1.02;
  const pos = (v: number | null) => (!isFigure(v) || max <= 0 ? 0 : (v / max) * 100);
  return (
    <div className={`${ART_TYPE_SCALE} space-y-3`}>
      {rows.map((f) => (
        <div key={f.family} className={`${STICKER} px-4 py-3`}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[19px] font-bold text-[#17202a]">{t(`families.${f.family}`)}</span>
            <span className={`${HAND} text-sm text-[#526b4f]`}>{t("salary.median", { v: fmtCzkShort(f.median) })}</span>
          </div>
          <div className="relative mt-2 h-6">
            <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded bg-[#dce7d0]" />
            {/* junior → lead band — only when both ends are real figures. */}
            {isFigure(f.junior) && isFigure(f.lead) ? (
              <div
                className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full border-[2px] border-[#17202a]"
                style={{ left: `${pos(f.junior)}%`, width: `${Math.max(2, pos(f.lead) - pos(f.junior))}%`, background: salaryColor(0.55) }}
              />
            ) : null}
            {/* median marker */}
            <div
              className="absolute top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded bg-[#17202a]"
              style={{ left: `${pos(f.median)}%` }}
              title={fmtCzk(f.median)}
            />
          </div>
          {isFigure(f.junior) || isFigure(f.lead) ? (
            <div className="mt-1 flex justify-between text-[16px] font-medium text-[#42606f]">
              <span>{isFigure(f.junior) ? `${t("salary.junior")} ${fmtCzkShort(f.junior)}` : ""}</span>
              <span>{isFigure(f.lead) ? `${t("salary.lead")} ${fmtCzkShort(f.lead)}` : ""}</span>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ── demand: ranked family bars with share + momentum ─────────────────────────
// Note: `demand.openings` takes `n` RAW, not through fmtInt. It is an ICU plural
// message, and intl-messageformat computes `value - offset` — a pre-formatted
// "11 571" became NaN and Czech rendered the literal word "NaN". ICU does the
// number formatting itself, per locale.
export function MomentumBadge({ m }: { m: number | null }) {
  const t = useTranslations("jobMarket");
  // `0` means "we measured no change", which is not an increase — showing it as
  // a green ▲ 0% would dress up a non-signal as good news.
  if (!isFigure(m) || m === 0)
    return <span className={`${ART_TYPE_SCALE} ${HAND} text-sm text-[#42606f]`}>{t("demand.momentumNew")}</span>;
  const up = m > 0;
  return (
    <span className={`${ART_TYPE_SCALE} text-sm font-bold`} style={{ color: up ? MOSS : CORAL }}>
      {up ? "▲" : "▼"} {Math.abs(m)}%
    </span>
  );
}

export function FamilyDemandList({ families }: { families: FamilyDemand[] }) {
  const t = useTranslations("jobMarket");
  const max = Math.max(...families.map((f) => f.vacancies), 0);
  // A family with 27 openings out of 38 000 is real; a 0.23%-wide bar and a
  // rounded "0%" both read as "none". Floor the bar and label sub-1% shares as
  // such instead of rounding them out of existence.
  const barWidth = (n: number) => (max > 0 ? Math.max(1.5, (n / max) * 100) : 0);
  return (
    <div className={`${ART_TYPE_SCALE} space-y-2.5`}>
      {families.map((f, i) => (
        <div key={f.family} className="flex items-center gap-3">
          <span className={`${DISPLAY} w-6 shrink-0 text-lg font-extrabold text-[#42606f]`}>{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[19px] font-bold text-[#17202a]">{t(`families.${f.family}`)}</span>
              <span className="shrink-0 text-[17px] font-bold text-[#42606f]">{t("demand.openings", { n: f.vacancies })}</span>
            </div>
            <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full border-[2px] border-[#17202a] bg-white">
              <div className="h-full rounded-full" style={{ width: `${barWidth(f.vacancies)}%`, background: familyColor(f.family) }} />
            </div>
          </div>
          <span className="w-14 shrink-0 text-right text-[17px] font-bold text-[#526b4f]">
            {!isFigure(f.share)
              ? ""
              : f.share > 0 && f.share < 0.005
              ? t("demand.shareTiny")
              : t("demand.share", { pct: (f.share * 100).toFixed(0) })}
          </span>
        </div>
      ))}
    </div>
  );
}

export function OccupationList({ occupations }: { occupations: Occupation[] }) {
  return (
    <ol className={`${ART_TYPE_SCALE} divide-y-[2px] divide-[#dce7d0]`}>
      {occupations.map((o, i) => (
        <li key={o.czIsco} className="flex items-center gap-3 py-2.5">
          <span className={`${DISPLAY} w-6 shrink-0 text-base font-extrabold text-[#caa54c]`}>{i + 1}</span>
          <span className="min-w-0 flex-1 truncate text-[19px] font-medium text-[#17202a]" title={o.name}>
            {o.name}
          </span>
          <span className="shrink-0 text-[17px] font-bold text-[#42606f]">{fmtInt(o.vacancies)}</span>
          {/* Keep the column width so the list stays aligned, but leave the cell
              blank rather than parking an em-dash in a money column. */}
          <span className="w-28 shrink-0 text-right text-[17px] font-bold text-[#526b4f]">
            {isFigure(o.medianSalary) ? fmtCzk(o.medianSalary) : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ── org-type split ────────────────────────────────────────────────────────────
export function OrgSplit({ orgTypes }: { orgTypes: OrgType[] }) {
  const t = useTranslations("jobMarket");
  const max = Math.max(...orgTypes.map((o) => (isFigure(o.medianSalary) ? o.medianSalary : 0)), 0);
  return (
    <div className={`${ART_TYPE_SCALE} grid gap-3 sm:grid-cols-3`}>
      {orgTypes.map((o) => {
        // Pay comes from the ISPV wage spheres, which have no counterpart for
        // staffing agencies — an agency is who posts the job, not a sphere of
        // the economy. That tile keeps its (real) opening count and simply
        // carries no pay figure, instead of an em-dash over an empty bar.
        const pay = isFigure(o.medianSalary) ? o.medianSalary : null;
        return (
          <div key={o.orgType} className={`${STICKER} px-4 py-4`}>
            <div className={`${HAND} text-sm`} style={{ color: orgColor(o.orgType) }}>
              {t(`orgTypes.${o.orgType}`)}
            </div>
            {pay != null ? (
              <>
                <div className={`${DISPLAY} mt-1 text-2xl font-extrabold`}>{fmtCzk(pay)}</div>
                <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full border-[2px] border-[#17202a] bg-white">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${max > 0 ? (pay / max) * 100 : 0}%`, background: orgColor(o.orgType) }}
                  />
                </div>
              </>
            ) : (
              <div className={`${DISPLAY} mt-1 text-2xl font-extrabold`}>{fmtInt(o.vacancies)}</div>
            )}
            <div className="mt-2 text-[17px] font-medium text-[#42606f]">
              {pay != null ? t("demand.openings", { n: o.vacancies }) : t("orgTypes.openingsOnly")}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── JD reference gallery (family filter + cards) ──────────────────────────────
export function JdCard({ item }: { item: JdGroup["items"][number] }) {
  const t = useTranslations("jobMarket");
  // Most ÚP postings advertise a floor and no ceiling. Printing that floor bare
  // reads as "the salary" when it is the bottom of an open band — say "from".
  const lo = isFigure(item.salaryMin) ? item.salaryMin : null;
  const hi = isFigure(item.salaryMax) ? item.salaryMax : null;
  const salary =
    lo == null && hi == null
      ? t("jd.salaryHidden")
      : lo != null && hi != null && hi !== lo
      ? `${fmtCzkShort(lo)} – ${fmtCzkShort(hi)}`
      : lo != null && hi == null
      ? t("jd.salaryFrom", { v: fmtCzk(lo) })
      : fmtCzk(hi ?? lo);
  return (
    <div className={`${ART_TYPE_SCALE} ${STICKER} flex flex-col gap-2 px-4 py-4`}>
      <h4 className={`${DISPLAY} text-[21px] font-extrabold leading-tight`}>{item.title}</h4>
      {item.employer || item.region ? (
        <p className="text-[17px] font-medium text-[#42606f]">
          {[item.employer, item.region].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[19px] font-bold text-[#526b4f]">{salary}</p>
        {item.posted ? (
          <span className="shrink-0 rounded-md bg-[#dce7d0] px-2 py-0.5 text-[15px] font-bold text-[#42606f]">
            {t("jd.posted", { date: fmtDate(item.posted) })}
          </span>
        ) : null}
      </div>
      {item.skills.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {item.skills.slice(0, 5).map((s, i) => (
            <span key={i} className="rounded-md border-[2px] border-[#17202a] bg-[#fdf8ee] px-2 py-0.5 text-[16px] font-medium">
              {s}
            </span>
          ))}
        </div>
      )}
      <span className={`${HAND} mt-auto pt-1 text-sm`} style={{ color: orgColor(item.orgType) }}>
        {t(`orgTypes.${item.orgType}`)}
      </span>
    </div>
  );
}
