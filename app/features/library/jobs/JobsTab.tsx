"use client";

import { useTranslations } from "next-intl";
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
  const enumLabel = useEnumLabel();
  const list = useJobsList();
  const { jobs, stats, error, fetching, openOnly, setOpenOnly, anyFilter, clearAll, reload, patchJobStatus } = list;

  const { openJob, setOpenJob, armPendingOpen } = useJobsTabDeepLink(jobs);

  return (
    // Tier 1 (docs/LOADING_CHOREOGRAPHY.md): header, filters and the table's
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

      {/* Tier 3: each panel owns its own fetch (drafts status / rediscovery
          sweep) — deferring the mount pushes those network calls a beat behind
          the primary jobs list fetch below. Both render nothing while empty, so
          there is no placeholder to reserve. */}
      <Defer strategy="next-frame">
        <DraftsPanel />
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
