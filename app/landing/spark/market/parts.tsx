"use client";

/*
 * Shared Market Pulse building blocks — the data-viz vocabulary both the Atlas
 * and Board variants compose from. All Spark art direction (literal hexes, the
 * docs/design/README.md exemption). Every user-facing string resolves through the
 * `jobMarket` i18n namespace; region/occupation/employer names come straight
 * from the (Czech) source data.
 */
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { DISPLAY, HAND, STICKER, INK, CORAL, MOSS } from "../tokens";
import {
  fmtCzk,
  fmtCzkShort,
  fmtInt,
  fmtDate,
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
    <div className={`${STICKER} px-5 py-4`} style={{ transform: `rotate(${tilt}deg)` }}>
      <div className={`${DISPLAY} text-3xl font-extrabold leading-none sm:text-4xl`}>{value}</div>
      <div className="mt-1.5 text-[13px] font-bold uppercase tracking-wide text-[#42606f]">{label}</div>
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
    <div className="inline-flex rounded-xl border-[3px] border-[#17202a] bg-white p-1 shadow-[3px_3px_0_#17202a]">
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
    <div role="img" aria-label={t("map.legendScale", { desc, lo, mid, hi })} className="flex items-center gap-3">
      {/* Visual scale — decorative for AT (the aria-label above carries it). */}
      <div className="flex flex-col gap-1" aria-hidden>
        <span
          className="h-3 w-32 rounded-full border-[2px] border-[#17202a]"
          style={{ background: `linear-gradient(90deg, ${stops[0]}, ${stops[1]}, ${stops[2]})` }}
        />
        <span className="flex w-32 justify-between text-[11px] font-bold text-[#42606f]">
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
    <div className={`${STICKER} min-h-[212px] px-6 py-5`} role="status" aria-live="polite" aria-atomic="true">
      {!region ? (
        <div className="flex h-full min-h-[172px] flex-col items-center justify-center text-center">
          <p className={`${HAND} text-lg text-[#526b4f]`}>{t("map.hintTitle")}</p>
          <p className="mt-1 text-[15px] text-[#42606f]">{t("map.hintBody")}</p>
        </div>
      ) : (
        <>
          <p className={`${HAND} text-sm text-[#526b4f]`}>{region.code}</p>
          <h3 className={`${DISPLAY} text-2xl font-extrabold`}>{region.name}</h3>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <div className={`${DISPLAY} text-2xl font-extrabold text-[#d65a4a]`}>{fmtInt(region.vacancies)}</div>
              <div className="text-[12px] font-bold uppercase tracking-wide text-[#42606f]">{t("map.vacancies")}</div>
            </div>
            <div>
              <div className={`${DISPLAY} text-2xl font-extrabold text-[#526b4f]`}>{fmtCzk(region.medianSalary)}</div>
              <div className="text-[12px] font-bold uppercase tracking-wide text-[#42606f]">{t("map.median")}</div>
            </div>
          </div>
          {region.p25 != null && region.p75 != null ? (
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
  const max = Math.max(...families.map((f) => f.lead || 0)) * 1.02;
  const pos = (v: number | null) => (v == null ? 0 : (v / max) * 100);
  return (
    <div className="space-y-3">
      {families.map((f) => (
        <div key={f.family} className={`${STICKER} px-4 py-3`}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-bold text-[#17202a]">{t(`families.${f.family}`)}</span>
            <span className={`${HAND} text-sm text-[#526b4f]`}>{t("salary.median", { v: fmtCzkShort(f.median) })}</span>
          </div>
          <div className="relative mt-2 h-6">
            <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded bg-[#dce7d0]" />
            {/* junior → lead band */}
            <div
              className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full border-[2px] border-[#17202a]"
              style={{ left: `${pos(f.junior)}%`, width: `${Math.max(2, pos(f.lead) - pos(f.junior))}%`, background: salaryColor(0.55) }}
            />
            {/* median marker */}
            {f.median != null && (
              <div
                className="absolute top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded bg-[#17202a]"
                style={{ left: `${pos(f.median)}%` }}
                title={fmtCzk(f.median)}
              />
            )}
          </div>
          <div className="mt-1 flex justify-between text-[12px] font-medium text-[#42606f]">
            <span>{t("salary.junior")} {fmtCzkShort(f.junior)}</span>
            <span>{t("salary.lead")} {fmtCzkShort(f.lead)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── demand: ranked family bars with share + momentum ─────────────────────────
export function MomentumBadge({ m }: { m: number | null }) {
  const t = useTranslations("jobMarket");
  if (m == null) return <span className={`${HAND} text-sm text-[#42606f]`}>{t("demand.momentumNew")}</span>;
  const up = m >= 0;
  return (
    <span className="text-sm font-bold" style={{ color: up ? MOSS : CORAL }}>
      {up ? "▲" : "▼"} {Math.abs(m)}%
    </span>
  );
}

export function FamilyDemandList({ families, total }: { families: FamilyDemand[]; total: number }) {
  const t = useTranslations("jobMarket");
  const max = Math.max(...families.map((f) => f.vacancies));
  return (
    <div className="space-y-2.5">
      {families.map((f, i) => (
        <div key={f.family} className="flex items-center gap-3">
          <span className={`${DISPLAY} w-6 shrink-0 text-lg font-extrabold text-[#42606f]`}>{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[15px] font-bold text-[#17202a]">{t(`families.${f.family}`)}</span>
              <span className="shrink-0 text-[13px] font-bold text-[#42606f]">{t("demand.openings", { n: fmtInt(f.vacancies) })}</span>
            </div>
            <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full border-[2px] border-[#17202a] bg-white">
              <div className="h-full rounded-full" style={{ width: `${(f.vacancies / max) * 100}%`, background: familyColor(f.family) }} />
            </div>
          </div>
          <span className="w-12 shrink-0 text-right text-[13px] font-bold text-[#526b4f]">{(f.share * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

export function OccupationList({ occupations }: { occupations: Occupation[] }) {
  const t = useTranslations("jobMarket");
  return (
    <ol className="divide-y-[2px] divide-[#dce7d0]">
      {occupations.map((o, i) => (
        <li key={o.czIsco} className="flex items-center gap-3 py-2.5">
          <span className={`${DISPLAY} w-6 shrink-0 text-base font-extrabold text-[#caa54c]`}>{i + 1}</span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-[#17202a]" title={o.name}>
            {o.name}
          </span>
          <span className="shrink-0 text-[13px] font-bold text-[#42606f]">{fmtInt(o.vacancies)}</span>
          <span className="w-24 shrink-0 text-right text-[13px] font-bold text-[#526b4f]">{fmtCzk(o.medianSalary)}</span>
        </li>
      ))}
    </ol>
  );
}

// ── org-type split ────────────────────────────────────────────────────────────
export function OrgSplit({ orgTypes }: { orgTypes: OrgType[] }) {
  const t = useTranslations("jobMarket");
  const max = Math.max(...orgTypes.map((o) => o.medianSalary || 0));
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {orgTypes.map((o) => (
        <div key={o.orgType} className={`${STICKER} px-4 py-4`}>
          <div className={`${HAND} text-sm`} style={{ color: orgColor(o.orgType) }}>
            {t(`orgTypes.${o.orgType}`)}
          </div>
          <div className={`${DISPLAY} mt-1 text-2xl font-extrabold`}>{fmtCzk(o.medianSalary)}</div>
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full border-[2px] border-[#17202a] bg-white">
            <div className="h-full rounded-full" style={{ width: `${((o.medianSalary || 0) / max) * 100}%`, background: orgColor(o.orgType) }} />
          </div>
          <div className="mt-2 text-[13px] font-medium text-[#42606f]">{t("demand.openings", { n: fmtInt(o.vacancies) })}</div>
        </div>
      ))}
    </div>
  );
}

// ── JD reference gallery (family filter + cards) ──────────────────────────────
export function JdCard({ item }: { item: JdGroup["items"][number] }) {
  const t = useTranslations("jobMarket");
  const salary =
    item.salaryMin == null && item.salaryMax == null
      ? t("jd.salaryHidden")
      : item.salaryMax && item.salaryMin && item.salaryMax !== item.salaryMin
      ? `${fmtCzkShort(item.salaryMin)} – ${fmtCzkShort(item.salaryMax)}`
      : fmtCzk(item.salaryMin ?? item.salaryMax);
  return (
    <div className={`${STICKER} flex flex-col gap-2 px-4 py-4`}>
      <h4 className={`${DISPLAY} text-[17px] font-extrabold leading-tight`}>{item.title}</h4>
      <p className="text-[13px] font-medium text-[#42606f]">
        {item.employer || "—"}
        {item.region ? ` · ${item.region}` : ""}
      </p>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[15px] font-bold text-[#526b4f]">{salary}</p>
        {item.posted ? (
          <span className="shrink-0 rounded-md bg-[#dce7d0] px-2 py-0.5 text-[11px] font-bold text-[#42606f]">
            {t("jd.posted", { date: fmtDate(item.posted) })}
          </span>
        ) : null}
      </div>
      {item.skills.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {item.skills.slice(0, 5).map((s, i) => (
            <span key={i} className="rounded-md border-[2px] border-[#17202a] bg-[#fdf8ee] px-2 py-0.5 text-[12px] font-medium">
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
