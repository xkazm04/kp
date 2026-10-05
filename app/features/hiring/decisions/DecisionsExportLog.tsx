"use client";

// The audit artifact, offered where the decisions are actually made.
//
// The whole-trail CSV itself is not new (UAT LUC-ANA-11) — it lived on Insights →
// Analytics, two tabs from the queue. But "send me the trail of every AI-assisted
// decision" is a request that reaches the recruiter working THIS tab, and the
// answer here was to copy a paginated table by hand or to already know about a
// button somewhere else. An export nobody can find is, for a procurement
// checklist, an export that does not exist.
//
// Deliberately the SAME file from the SAME builder (useDecisionLogExport), not a
// second serializer in this directory: one regulated record with two exports that
// disagree about columns, clock or scope is an artifact nobody can file.
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit/Button";
import { NOTICE } from "@/app/_components/ui/recipes";
import { track } from "@/app/_lib/analytics/track";
import { decisionLogUrl } from "@/app/features/insights/analytics/decisionLogCsv";
import { useDecisionLogExport } from "@/app/features/insights/analytics/useDecisionLogExport";

export function DecisionsExportLog() {
  const t = useTranslations("decisions");
  // The file's own vocabulary stays in the log's namespace — the button is the
  // only string this surface owns, because the artifact is not this surface's.
  const tLog = useTranslations("analytics.log");
  const locale = useLocale();
  const { exportTrail, trailBusy, trailError } = useDecisionLogExport();

  // No row-count guard, unlike the Analytics table's button: that one knows the
  // trail's size from the page it already fetched, this one would need a request
  // to learn it. An empty trail is not a silent header-only file here — the
  // provenance block states `Whole trail · 0 of 0 rows`, which is the difference
  // between "we measured nothing" and "there was nothing to measure".
  const onExport = () => {
    track("analytics_export", { artifact: "kp-decision-log-trail.csv" });
    void exportTrail({
      // No narrowing. This header filters the QUEUE by role, and the trail has no
      // role axis on the wire (the route filters by kind, attribution and subject,
      // never by job), so a role-scoped export is not something this can honestly
      // offer. Exporting everything and SAYING so beats a file quietly scoped to
      // something the reader never asked for.
      url: (offset, limit) => decisionLogUrl({ offset, limit, sort: "createdAt", dir: "desc", locale }),
      filters: tLog("filtersNone"),
    });
  };

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        label={t("exportLog")}
        loading={trailBusy}
        loadingLabel={tLog("exportTrailBusy")}
        tip={t("exportLogTitle")}
        onClick={onExport}
      />
      {trailError ? (
        <p role="alert" className={`w-full ${NOTICE("critical")} px-3 py-2 text-meta`}>
          {trailError}
        </p>
      ) : null}
    </>
  );
}
