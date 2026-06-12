"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, SearchX, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { buildTabSwitchUrl } from "@/app/features/tabs";
import { formatPercent } from "@/app/_lib/format";
import {
  FAMILIES,
  SENIORITIES,
  MODES,
} from "./JobsTypes";
import type { Job } from "./JobsTypes";
import { Chip, EmptyState, Select } from "./JobsShared";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { JobsTableFrame, JobsTableSkeleton } from "./JobsTable";
import { JobRow } from "./JobRow";
import { JobPostingModal } from "./JobPostingModal";
import { DraftsPanel } from "./DraftsPanel";
import { IngestAdPanel } from "./IngestAdPanel";
import { useJobsList } from "./useJobsList";

export function JobsTab() {
  const t = useTranslations("jobs.tab");
  const enumLabel = useEnumLabel();
  const {
    jobs,
    stats,
    error,
    fetching,
    roleFamily,
    setRoleFamily,
    seniority,
    setSeniority,
    workMode,
    setWorkMode,
    entryOnly,
    setEntryOnly,
    q,
    setQ,
    anyFilter,
    clearAll,
    reload,
  } = useJobsList();

  const [openJob, setOpenJob] = useState<Job | null>(null);

  // A just-ingested job to auto-open once the refreshed corpus contains it
  // (mirrors the ?job= deep-link below). Applied during render, cleared on match.
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);
  if (jobs && pendingOpenId) {
    const match = jobs.find((j) => j.id === pendingOpenId);
    if (match) {
      setPendingOpenId(null);
      setOpenJob(match);
    }
  }

  // Deep link from the Pipeline (?tab=jobs&job=<id>): auto-open that job's
  // posting. Applied during render (guarded render-phase adjustment) once the
  // corpus is loaded — once per param value, so a list refetch can no longer
  // re-open a modal the user already closed.
  const search = useSearchParams();
  const jobParam = search.get("job");
  const [appliedJobParam, setAppliedJobParam] = useState<string | null>(null);
  if (jobs && jobParam !== appliedJobParam) {
    setAppliedJobParam(jobParam);
    const match = jobParam ? jobs.find((j) => j.id === jobParam) : null;
    if (match) setOpenJob(match);
  }

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          {t.rich("intro", { strong: (chunks) => <strong>{chunks}</strong> })}
        </p>
      </header>

      {stats ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip label={t("statTotal")} value={stats.total} />
          <Chip
            label={t("statEntryEligible")}
            value={`${stats.entryEligible} (${formatPercent((stats.entryEligible / Math.max(stats.total, 1)) * 100)})`}
            tone="green"
          />
          {Object.entries(stats.byRoleFamily).map(([k, v]) => (
            <Chip key={k} label={enumLabel("family", k)} value={v} />
          ))}
        </div>
      ) : null}

      <DraftsPanel />

      <IngestAdPanel
        onIngested={(result) => {
          // Refetch the corpus; the render-phase open above latches onto the new
          // (or existing, on a dedup hit) job id once it lands in the list.
          setPendingOpenId(result.jobId);
          reload();
        }}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Select value={roleFamily} onChange={setRoleFamily} all={t("allFamilies")} label={t("filterFamily")}>
          {FAMILIES.map((f) => (
            <option key={f} value={f}>
              {enumLabel("family", f)}
            </option>
          ))}
        </Select>
        <Select value={seniority} onChange={setSeniority} all={t("allSeniority")} label={t("filterSeniority")}>
          {SENIORITIES.map((s) => (
            <option key={s} value={s} className="capitalize">
              {enumLabel("seniority", s)}
            </option>
          ))}
        </Select>
        <Select value={workMode} onChange={setWorkMode} all={t("allModes")} label={t("filterWorkMode")}>
          {MODES.map((m) => (
            <option key={m} value={m} className="capitalize">
              {enumLabel("workMode", m)}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 rounded-md border border-stone-200 px-3 py-2 text-base text-ink">
          <input
            type="checkbox"
            checked={entryOnly}
            onChange={(e) => setEntryOnly(e.target.checked)}
            className="h-4 w-4 accent-coral"
          />
          {t("entryOnly")}
        </label>
        <label htmlFor="jobs-search" className="sr-only">
          {t("searchLabel")}
        </label>
        <input
          id="jobs-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="focus-ring h-10 flex-1 min-w-[180px] rounded-md border border-stone-200 px-3 text-base"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-base" aria-live="polite">
        {jobs && stats ? (
          <span className="text-steel">
            {t.rich("showing", {
              shown: jobs.length,
              total: stats.total,
              b: (chunks) => <span className="font-semibold nums text-ink">{chunks}</span>,
            })}
          </span>
        ) : null}
        {anyFilter ? (
          <button
            type="button"
            onClick={clearAll}
            className="focus-ring inline-flex items-center gap-1 rounded-full border border-coral/40 bg-coral/5 px-2.5 py-0.5 text-sm font-semibold text-coral hover:bg-coral/10"
          >
            <X size={12} aria-hidden /> {t("clearAll")}
          </button>
        ) : null}
      </div>

      <div className="mt-5">
        {error ? (
          <p className="rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
        ) : jobs == null ? (
          <JobsTableFrame>
            <JobsTableSkeleton />
          </JobsTableFrame>
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title={anyFilter ? t("noRolesTitle") : t("noRolesEmptyTitle")}
            body={anyFilter ? t("noRolesBody") : t("noRolesEmptyBody")}
            action={
              anyFilter ? (
                <button
                  type="button"
                  onClick={clearAll}
                  className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-base font-semibold text-ink hover:bg-stone-50"
                >
                  <X size={14} aria-hidden /> {t("clearAllFilters")}
                </button>
              ) : (
                // Chain-aware empty state: an empty corpus points upstream to the
                // step that produces jobs (the JD library), not at a filter reset.
                <Link
                  href={buildTabSwitchUrl("library", search.toString())}
                  className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-base font-semibold text-ink hover:border-coral/40"
                >
                  {t("noRolesEmptyCta")} <ArrowRight size={14} aria-hidden />
                </Link>
              )
            }
          />
        ) : (
          <div
            className={
              fetching
                ? "animate-pulse opacity-60 transition-opacity motion-reduce:animate-none"
                : "transition-opacity"
            }
            aria-busy={fetching}
          >
            <JobsTableFrame>
              <tbody className="divide-y divide-stone-200">
                {jobs.map((job) => (
                  <JobRow key={job.id} job={job} onOpen={() => setOpenJob(job)} />
                ))}
              </tbody>
            </JobsTableFrame>
          </div>
        )}
      </div>

      {openJob ? <JobPostingModal job={openJob} onClose={() => setOpenJob(null)} /> : null}
    </section>
  );
}
