"use client";

/*
 * Variant A — "Atlas". An editorial cartography: the region map is a large hero
 * you read the country through, with a reactive detail card beside it, then the
 * story unfolds as a single generous scroll — a salary field-guide, the demand
 * leaderboard, the sector split, and a job-description gallery. Centred section
 * headers, warm annotations; one idea at a time. Contrast to Board (everything
 * at once). Reuses the shared market parts.
 */
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ART_TYPE_SCALE, DISPLAY, HAND } from "../tokens";
import { snapshot, fmtInt, fmtCzkShort, metricValues, type MapMetric } from "./data";
import CzMap from "./CzMap";
import { marketMapSelection, type MarketMapSelection } from "./map-url";
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

export default function MarketPulseAtlas({ initialSelection }: { initialSelection: MarketMapSelection }) {
  const t = useTranslations("jobMarket");
  const locale = useLocale();
  const [metric, setMetric] = useState<MapMetric>(initialSelection.metric);
  // The server reads the URL for the first render, avoiding a hydration flash
  // from Praha to the linked region.
  const [active, setActive] = useState<string | null>(initialSelection.region);
  useEffect(() => {
    const onPopState = () => {
      const query = new URLSearchParams(window.location.search);
      const selection = marketMapSelection(query.get("region"), query.get("metric"));
      setActive(selection.region);
      setMetric(selection.metric);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const updateUrl = (region: string, nextMetric: MapMetric) => {
    const url = new URL(window.location.href);
    url.searchParams.set("region", region);
    url.searchParams.set("metric", nextMetric);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };
  const chooseMetric = (nextMetric: MapMetric) => {
    setMetric(nextMetric);
    if (active) updateUrl(active, nextMetric);
  };
  const chooseRegion = (code: string | null) => {
    setActive(code);
    if (code) updateUrl(code, metric);
  };
  // Only families that actually carry postings get a tab — an empty tab would
  // open onto a section header above blank space.
  const jdGroups = snapshot.jd_references.filter((g) => g.items.length > 0);
  const [jdFamily, setJdFamily] = useState<string>(jdGroups[0]?.family ?? "");

  const region = active ? snapshot.regions.find((r) => r.code === active) ?? null : null;
  // With no values behind the metric, `Math.min()` is Infinity and the midpoint
  // is NaN — which used to render as the literal words "Infinity" and "NaN" in
  // the legend and its aria-label. No values → no legend.
  const vals = metricValues(snapshot.regions, metric);
  const fmt = (n: number) => (metric === "volume" ? fmtInt(n, locale) : fmtCzkShort(n, locale));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const scale = vals.length ? { lo: fmt(min), mid: fmt((min + max) / 2), hi: fmt(max) } : null;
  const jdItems = jdGroups.find((g) => g.family === jdFamily)?.items ?? [];

  return (
    <div className="space-y-24">
      {/* ── Map hero ─────────────────────────────────────────── */}
      <section id="map" className="mx-auto grid max-w-7xl gap-6 px-6 lg:grid-cols-[1.5fr_1fr] lg:items-start">
        <div className="rounded-2xl border-[3px] border-[#17202a] bg-white p-5 shadow-[6px_6px_0_#17202a]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <MetricToggle metric={metric} onChange={chooseMetric} />
            {scale ? <MapLegend metric={metric} lo={scale.lo} mid={scale.mid} hi={scale.hi} /> : null}
          </div>
          <CzMap regions={snapshot.regions} metric={metric} activeCode={active} onActivate={chooseRegion} className="h-auto w-full" />
        </div>
        <div className="space-y-4 lg:sticky lg:top-6">
          <RegionDetail region={region} />
          <div
            className={`${ART_TYPE_SCALE} rounded-2xl border-[3px] border-[#17202a] bg-[#dce7d0] px-5 py-4 shadow-[6px_6px_0_#17202a]`}
          >
            <p className={`${HAND} text-sm text-[#526b4f]`}>{t("map.topRegions")}</p>
            <ol className="mt-2 space-y-1.5">
              {[...snapshot.regions].sort((a, b) => b.vacancies - a.vacancies).slice(0, 5).map((r, i) => (
                <li key={r.code} className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[19px] font-bold">{i + 1}. {r.name}</span>
                  <span className="shrink-0 text-[17px] font-bold text-[#42606f]">{fmtInt(r.vacancies, locale)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ── Salary field guide ───────────────────────────────── */}
      <section id="salary" className="mx-auto max-w-5xl px-6">
        {/* The subtitle now states the BASIS (gross monthly) and the VINTAGE — the
            survey year was in the snapshot's meta and never reached the reader, so a
            German or French visitor could read a 2025 gross figure as this year's net.
            No period in the snapshot → the sentence without it, never a guessed year. */}
        <SectionHead
          eyebrow={t("salary.eyebrow")}
          title={t("salary.title")}
          sub={
            snapshot.meta.ispv_period
              ? t("salary.subtitleDated", { period: snapshot.meta.ispv_period })
              : t("salary.subtitle")
          }
        />
        <SalaryBands families={snapshot.reference_salaries} />
      </section>

      {/* ── Demand ───────────────────────────────────────────── */}
      <section id="demand" className="mx-auto max-w-7xl px-6">
        <SectionHead eyebrow={t("demand.eyebrow")} title={t("demand.title")} sub={t("demand.subtitle")} />
        {/* The two column labels belong to the lists under them, so they take
            the card scale with them rather than the editorial one. */}
        <div className={`${ART_TYPE_SCALE} grid gap-8 lg:grid-cols-2`}>
          <div>
            <p className="mb-3 text-[17px] font-bold uppercase tracking-wide text-[#42606f]">{t("demand.byFamily")}</p>
            <FamilyDemandList families={snapshot.demand.top_families} />
          </div>
          <div>
            <p className="mb-3 text-[17px] font-bold uppercase tracking-wide text-[#42606f]">{t("demand.byRole")}</p>
            <OccupationList occupations={snapshot.demand.top_occupations.slice(0, 12)} />
          </div>
        </div>
      </section>

      {/* ── Sector split ─────────────────────────────────────── */}
      <section id="sectors" className="mx-auto max-w-5xl px-6">
        <SectionHead eyebrow={t("orgTypes.eyebrow")} title={t("orgTypes.title")} sub={t("orgTypes.subtitle")} />
        <OrgSplit orgTypes={snapshot.org_types} />
      </section>

      {/* ── JD reference gallery ─────────────────────────────── */}
      {jdGroups.length ? (
      <section id="jd" className="mx-auto max-w-7xl px-6">
        <SectionHead eyebrow={t("jd.eyebrow")} title={t("jd.title")} sub={t("jd.subtitle")} />
        <div className={`${ART_TYPE_SCALE} mb-6 flex flex-wrap justify-center gap-2`}>
          {jdGroups.map((g) => {
            const on = g.family === jdFamily;
            return (
              <button
                key={g.family}
                type="button"
                onClick={() => setJdFamily(g.family)}
                className="rounded-lg border-[3px] border-[#17202a] px-3 py-1.5 text-[17px] font-bold transition-all"
                style={{ background: on ? "#17202a" : "#fff", color: on ? "#fdf8ee" : "#17202a", boxShadow: on ? "none" : "3px 3px 0 #17202a" }}
              >
                {t(`families.${g.family}`)}
              </button>
            );
          })}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jdItems.map((item, i) => <JdCard key={i} item={item} />)}
        </div>
      </section>
      ) : null}
    </div>
  );
}
