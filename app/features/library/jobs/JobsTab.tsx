"use client";

import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { formatPercent } from "@/app/_lib/format";
import { Chip } from "./JobsShared";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { Defer } from "@/app/_components/ui/Defer";
import { JobPostingModal } from "./JobsPostingModal";
import { DraftsPanel } from "./JobsDraftsPanel";
import { RediscoveryFeed } from "./JobsRediscoveryFeed";
import { IngestAdPanel } from "./JobsIngestAdPanel";
import { useJobsList } from "./useJobsList";
import { ingestNeedsOpenFilterCleared } from "./jobsIngestLatch";
import { useJobsTabDeepLink } from "./jobsTabDeepLink";
import { JobsTabFilters } from "./JobsTabFilters";
import { JobsTabResults } from "./JobsTabResults";

export function JobsTab() {
  const t = useTranslations("jobs.tab");
  // Deep-link (?job=) resolution messages — their own namespace: they belong to the
  // link, not to the table chrome.
  const td = useTranslations("jobs.deeplink");
  const enumLabel = useEnumLabel();
  const list = useJobsList();
  const { jobs, stats, error, fetching, openOnly, setOpenOnly, anyFilter, clearAll, reload, patchJobStatus } = list;

  const { openJob, setOpenJob, armPendingOpen, lookupMissed, dismissLookupMissed } = useJobsTabDeepLink(jobs);

  // Entry-eligible share of the WHOLE catalog: both halves come from jobStats, which
  // is workspace-wide and unfiltered, so the chip's numerator and denominator are one
  // population regardless of the filters applied to the table below.
  const entryPct = stats ? (stats.entryEligible / Math.max(stats.total, 1)) * 100 : 0;

  return (
    // Tier 1 (docs/design/loading-choreography.md): header, filters and the table's
    // column headers are chrome — they render on the first frame regardless of
    // the corpus fetch. aria-busy covers the first load only; a later refetch
    // (filter change) never blanks what is already on screen.
    <section
      className="stagger-children rounded-lg border border-stone-200 bg-white p-5 shadow-panel"
      aria-busy={jobs == null && !error}
    >
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          {t.rich("intro", { strong: (chunks) => <strong>{chunks}</strong> })}
        </p>
      </header>

      {lookupMissed ? (
        // Deep link to a role that no longer resolves (deleted, or another team's).
        // Says so instead of opening nothing — amber, the app's "partial/attention" tone.
        <div
          role="status"
          className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-base text-amber-800"
        >
          <span className="flex-1">{td("notFound")}</span>
          <button
            type="button"
            onClick={dismissLookupMissed}
            aria-label={td("dismiss")}
            className="focus-ring shrink-0 rounded-md p-0.5 text-amber-800 hover:text-ink"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}

      {stats ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip label={t("statTotal")} value={stats.total} />
          <Chip
            label={t("statEntryEligible")}
            // A share that exists must never print as an absolute zero: at whole-number
            // precision a workspace with 1 entry-eligible role in 400 rendered
            // "1 (0%)" — its own count contradicting its own percentage. A sub-0.5%
            // share (and only that case) keeps one decimal; every ordinary share stays
            // the whole number the chip has always shown.
            value={`${stats.entryEligible} (${formatPercent(entryPct, { digits: entryPct > 0 && entryPct < 0.5 ? 1 : 0 })})`}
            tone="green"
          />
          {Object.entries(stats.byRoleFamily).map(([k, v]) => (
            <Chip key={k} label={enumLabel("family", k)} value={v} />
          ))}
        </div>
      ) : null}

      {/* Tier 3: each panel owns its own fetch (drafts status / rediscovery
          sweep) — deferring the mount pushes those network calls a beat behind
          the primary jobs list fetch below. Both render nothing while empty, so
          there is no placeholder to reserve. */}
      <Defer strategy="next-frame">
        <DraftsPanel
          onPublished={(jobId) => {
            // Same pair the modal publish path uses (below): flip the row's badge
            // instantly, then reconcile stats + the openOnly filter against the server.
            patchJobStatus(jobId, "published");
            reload();
          }}
        />
      </Defer>

      <Defer strategy="idle">
        <RediscoveryFeed />
      </Defer>

      <IngestAdPanel
        onIngested={(result) => {
          // Single-ad path: refetch the corpus; the render-phase open above latches
          // onto the new (or existing, on a dedup hit) job id once it lands in the list.
          // #5: the latch remembers the CURRENT jobs array so it resolves against the
          // NEXT refresh only. Ingest always inserts a draft, which the "open only"
          // filter hides — so clear that filter here or the draft could never surface
          // and the modal would silently never open.
          if (ingestNeedsOpenFilterCleared(openOnly)) setOpenOnly(false);
          armPendingOpen(result.jobId);
          reload();
        }}
        // Bulk path: one refetch after the whole import, and NO auto-open — the per-row
        // results table already reports each outcome (JOB #4).
        onBulkComplete={() => reload()}
      />

      <JobsTabFilters list={list} />

      <JobsTabResults
        jobs={jobs}
        stats={stats}
        error={error}
        fetching={fetching}
        anyFilter={anyFilter}
        clearAll={clearAll}
        onOpen={setOpenJob}
      />

      {openJob ? (
        <JobPostingModal
          job={openJob}
          onClose={() => setOpenJob(null)}
          onChanged={(status) => {
            // Instant: flip the open row's badge/chips. Then reconcile the whole
            // list (stats + the openOnly filter) against server truth.
            patchJobStatus(openJob.id, status);
            reload();
          }}
        />
      ) : null}
    </section>
  );
}
