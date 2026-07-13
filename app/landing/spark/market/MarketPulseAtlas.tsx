"use client";

/*
 * Variant A — "Atlas". An editorial cartography: the region map is a large hero
 * you read the country through, with a reactive detail card beside it, then the
 * story unfolds as a single generous scroll — a salary field-guide, the demand
 * leaderboard, the sector split, and a job-description gallery. Centred section
 * headers, warm annotations; one idea at a time. Contrast to Board (everything
 * at once). Reuses the shared market parts.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { DISPLAY, HAND } from "../tokens";
import { snapshot, fmtInt, fmtCzkShort, type MapMetric } from "./data";
import CzMap from "./CzMap";
import {
  MetricToggle,
  MapLegend,
  RegionDetail,
  SalaryBands,
  FamilyDemandList,
  OccupationList,
  OrgSplit,
  JdCard,
} from "./parts";

function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="mx-auto mb-8 max-w-2xl text-center">
      <p className={`${HAND} text-lg text-[#526b4f]`}>{eyebrow}</p>
      <h2 className={`${DISPLAY} mt-1 text-3xl font-extrabold sm:text-4xl`}>{title}</h2>
      {sub ? <p className="mt-3 text-lg text-[#42606f]">{sub}</p> : null}
    </div>
  );
}

export default function MarketPulseAtlas() {
  const t = useTranslations("jobMarket");
  const [metric, setMetric] = useState<MapMetric>("volume");
  // Preselect Praha (CZ010) so the detail card always shows a region — hovering
  // then only swaps its text, never collapses/expands the layout.
  const [active, setActive] = useState<string | null>("CZ010");
  const [jdFamily, setJdFamily] = useState<string>(snapshot.jd_references[0]?.family ?? "");

  const region = active ? snapshot.regions.find((r) => r.code === active) ?? null : null;
  const vals = snapshot.regions
    .map((r) => (metric === "volume" ? r.vacancies : r.medianSalary))
    .filter((v): v is number => v != null);
  const fmt = metric === "volume" ? fmtInt : fmtCzkShort;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const lo = fmt(min);
  const mid = fmt((min + max) / 2);
  const hi = fmt(max);
  const jdGroup = snapshot.jd_references.find((g) => g.family === jdFamily);

  return (
    <div className="space-y-24">
      {/* ── Map hero ─────────────────────────────────────────── */}
      <section id="map" className="mx-auto grid max-w-6xl gap-6 px-6 lg:grid-cols-[1.5fr_1fr] lg:items-start">
        <div className="rounded-2xl border-[3px] border-[#17202a] bg-white p-5 shadow-[6px_6px_0_#17202a]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <MetricToggle metric={metric} onChange={setMetric} />
            <MapLegend metric={metric} lo={lo} mid={mid} hi={hi} />
          </div>
          <CzMap regions={snapshot.regions} metric={metric} activeCode={active} onActivate={setActive} className="h-auto w-full" />
        </div>
        <div className="space-y-4 lg:sticky lg:top-6">
          <RegionDetail region={region} />
          <div className="rounded-2xl border-[3px] border-[#17202a] bg-[#dce7d0] px-5 py-4 shadow-[6px_6px_0_#17202a]">
            <p className={`${HAND} text-sm text-[#526b4f]`}>{t("map.topRegions")}</p>
            <ol className="mt-2 space-y-1.5">
              {[...snapshot.regions].sort((a, b) => b.vacancies - a.vacancies).slice(0, 5).map((r, i) => (
                <li key={r.code} className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[15px] font-bold">{i + 1}. {r.name}</span>
                  <span className="shrink-0 text-[13px] font-bold text-[#42606f]">{fmtInt(r.vacancies)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ── Salary field guide ───────────────────────────────── */}
      <section id="salary" className="mx-auto max-w-4xl px-6">
        <SectionHead eyebrow={t("salary.eyebrow")} title={t("salary.title")} sub={t("salary.subtitle")} />
        <SalaryBands families={snapshot.reference_salaries} />
      </section>

      {/* ── Demand ───────────────────────────────────────────── */}
      <section id="demand" className="mx-auto max-w-6xl px-6">
        <SectionHead eyebrow={t("demand.eyebrow")} title={t("demand.title")} sub={t("demand.subtitle")} />
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <p className="mb-3 text-[13px] font-bold uppercase tracking-wide text-[#42606f]">{t("demand.byFamily")}</p>
            <FamilyDemandList families={snapshot.demand.top_families} total={snapshot.demand.national_total} />
          </div>
          <div>
            <p className="mb-3 text-[13px] font-bold uppercase tracking-wide text-[#42606f]">{t("demand.byRole")}</p>
            <OccupationList occupations={snapshot.demand.top_occupations.slice(0, 12)} />
          </div>
        </div>
      </section>

      {/* ── Sector split ─────────────────────────────────────── */}
      <section id="sectors" className="mx-auto max-w-4xl px-6">
        <SectionHead eyebrow={t("orgTypes.eyebrow")} title={t("orgTypes.title")} sub={t("orgTypes.subtitle")} />
        <OrgSplit orgTypes={snapshot.org_types} />
      </section>

      {/* ── JD reference gallery ─────────────────────────────── */}
      <section id="jd" className="mx-auto max-w-6xl px-6">
        <SectionHead eyebrow={t("jd.eyebrow")} title={t("jd.title")} sub={t("jd.subtitle")} />
        <div className="mb-6 flex flex-wrap justify-center gap-2">
          {snapshot.jd_references.map((g) => {
            const on = g.family === jdFamily;
            return (
              <button
                key={g.family}
                type="button"
                onClick={() => setJdFamily(g.family)}
                className="rounded-lg border-[3px] border-[#17202a] px-3 py-1.5 text-[13px] font-bold transition-all"
                style={{ background: on ? "#17202a" : "#fff", color: on ? "#fdf8ee" : "#17202a", boxShadow: on ? "none" : "3px 3px 0 #17202a" }}
              >
                {t(`families.${g.family}`)}
              </button>
            );
          })}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jdGroup?.items.map((item, i) => <JdCard key={i} item={item} />)}
        </div>
      </section>
    </div>
  );
}
