"use client";

// The "Cases" sub-tab: case detail reader OR the cases table + automated-lifecycle
// list, split out of DevTab.tsx. Owns the CaseDetail/LifecycleSection dynamic
// imports since both are only ever needed from this view.
import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { Defer } from "@/app/_components/ui/Defer";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import type { LoadState } from "@/app/_lib/load-state";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { CasesTable } from "./DevCasesTable";
import type { CaseFilters } from "./DevCasesTable.filter";
import type { CaseLedgerFacets, CaseLedgerRow, DevCaseDetail, Lifecycle, Posting } from "./DevTypes";

// Tier 3 (docs/design/loading-choreography.md): the automated-lifecycle list is
// secondary to the cases table it sits under, and the case detail reader (with
// its submissions/eval/compare panels) is heavy and only ever needed after a
// click. Both get their own chunk so the "cases" view's first paint carries the
// cases table alone; the chunk gap is a quiet reserved box, never a skeleton.
const chunkGap = (minHeight: string) => {
  const Gap = () => <div className={`reveal-quiet ${minHeight}`} aria-hidden />;
  Gap.displayName = "DevTabChunkGap";
  return Gap;
};
const LifecycleSection = dynamic(() => import("./DevLifecycleSection").then((m) => ({ default: m.LifecycleSection })), {
  loading: chunkGap("min-h-[10rem]"),
});
const CaseDetail = dynamic(() => import("./DevCaseDetail").then((m) => ({ default: m.CaseDetail })), {
  loading: chunkGap("min-h-[24rem]"),
});

/** The detail reader's record AND its channels, read by id when a ledger row is opened:
 *  GET /api/devcase/[id] (the design JSON the ledger projection no longer carries) and
 *  GET /api/devcase/[id]/channels (this case's postings, SQL-scoped, submissions inlined
 *  and enriched - challenge-r09 devcase-lifecycle/A), in parallel, under ONE version key.
 *  The detail used to filter the workspace's whole postings fold down to its own case in
 *  the browser. A foreign or deleted id answers a coded 404 from either door, shown in the
 *  reader's language with the way back, rather than an empty reader. */
function CaseDetailById({ caseId, version, onBack, children }: {
  caseId: string;
  /** Re-read when the ledger reloads (a finished lifecycle step can materialize the
   *  seed or scenario this reader shows) or the studio bumps the detail (an evaluation
   *  finished, a publish landed); the last good record stays up meanwhile. */
  version: string;
  onBack: () => void;
  children: (kase: DevCaseDetail, casePostings: Posting[]) => ReactNode;
}) {
  const tDetail = useTranslations("devcase.studio.detail");
  const tErrors = useTranslations("errors");
  const errorMessage = useErrorMessage();
  const [loaded, setLoaded] = useState<{ id: string; kase: DevCaseDetail | null; postings: Posting[]; error: string | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const [r, rc] = await Promise.all([
          fetch(`/api/devcase/${encodeURIComponent(caseId)}`, { signal: controller.signal }),
          fetch(`/api/devcase/${encodeURIComponent(caseId)}/channels`, { signal: controller.signal }),
        ]);
        const body = (await r.json().catch(() => null)) as { case?: DevCaseDetail; code?: string | null } | null;
        const channels = (await rc.json().catch(() => null)) as { postings?: Posting[]; code?: string | null } | null;
        if (controller.signal.aborted) return;
        if (!r.ok || !body?.case) {
          setLoaded({ id: caseId, kase: null, postings: [], error: errorMessage(body, tErrors("DEVCASE_CASE_LIST_FAILED")) });
          return;
        }
        if (!rc.ok || !Array.isArray(channels?.postings)) {
          // Not an empty channel list: "no postings" would tell the recruiter the case was
          // never published. The failure is named instead.
          setLoaded({ id: caseId, kase: null, postings: [], error: errorMessage(channels, tErrors("DEVCASE_POSTINGS_FAILED")) });
          return;
        }
        setLoaded({ id: caseId, kase: body.case, postings: channels.postings, error: null });
      } catch {
        // An abort is the reader leaving (or opening another row), not a failure;
        // anything else is named, with the way back.
        if (!controller.signal.aborted) {
          setLoaded({ id: caseId, kase: null, postings: [], error: tErrors("DEVCASE_CASE_LIST_FAILED") });
        }
      }
    })();
    return () => controller.abort();
  }, [caseId, version, errorMessage, tErrors]);

  const current = loaded?.id === caseId ? loaded : null;
  if (current?.kase) return <>{children(current.kase, current.postings)}</>;
  if (current?.error) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={onBack}
          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-steel hover:bg-paper hover:text-ink"
        >
          <ArrowLeft size={14} aria-hidden /> {tDetail("back")}
        </button>
        <p role="alert" className="rounded-md border border-coral/30 bg-coral/10 px-3 py-2 text-sm text-coral">
          {current.error}
        </p>
      </div>
    );
  }
  // A fetch the reader just asked for: announced (LoadingGap is role="status"), unlike
  // the silent chunk gaps above, which only cover a code-split frame.
  return <LoadingGap className="min-h-[24rem]" />;
}

export function DevTabCasesView({
  cases,
  casesTruncated,
  caseFacets,
  caseFilters,
  caseFiltersActive,
  onCaseFiltersChange,
  onLoadMoreCases,
  casesState,
  lifecycles,
  lifecyclesState,
  detailVersion,
  selectedCaseId,
  onOpenCase,
  onBack,
  onDefine,
  publish,
  publishingCase,
  source,
  sourcing,
  sourcedCounts,
  reloadDetail,
  approveLifecycle,
  loadLifecycles,
  lifecycleFocus = null,
}: {
  cases: CaseLedgerRow[];
  casesTruncated: boolean;
  caseFacets: CaseLedgerFacets;
  caseFilters: CaseFilters;
  caseFiltersActive: boolean;
  onCaseFiltersChange: (next: CaseFilters) => void;
  onLoadMoreCases?: () => void;
  casesState: LoadState;
  lifecycles: Lifecycle[];
  lifecyclesState: LoadState;
  /** Bumped by the studio when the open case's channels changed (an evaluation finished,
   *  a publish landed, a lifecycle step ran): the detail re-reads its one case. */
  detailVersion: number;
  selectedCaseId: string | null;
  onOpenCase: (id: string) => void;
  onBack: () => void;
  onDefine: () => void;
  publish: (caseId: string) => void;
  publishingCase: string | null;
  source: (caseId: string) => void;
  sourcing: string | null;
  sourcedCounts: Record<string, number>;
  reloadDetail: () => void;
  approveLifecycle: (id: string) => void;
  loadLifecycles: () => void;
  /** The lifecycle a ?lifecycle= address pointed at (assignmentsDeepLink.ts). */
  lifecycleFocus?: { id: string; openReview: boolean; nonce: number } | null;
}) {
  if (selectedCaseId) {
    return (
      <CaseDetailById caseId={selectedCaseId} version={`${casesState.lastUpdated ?? ""}:${detailVersion}`} onBack={onBack}>
        {(kase, casePostings) => (
          <CaseDetail
            kase={kase}
            casePostings={casePostings}
            onBack={onBack}
            publish={publish}
            publishing={publishingCase === kase.id}
            source={source}
            sourcing={sourcing}
            sourcedCounts={sourcedCounts}
            reloadDetail={reloadDetail}
          />
        )}
      </CaseDetailById>
    );
  }
  return (
    <>
      <CasesTable
        cases={cases}
        truncated={casesTruncated}
        facets={caseFacets}
        filters={caseFilters}
        filtersActive={caseFiltersActive}
        onFiltersChange={onCaseFiltersChange}
        state={casesState}
        onOpen={onOpenCase}
        onDefine={onDefine}
        onLoadMore={onLoadMoreCases}
      />
      {/* Tier 3: secondary to the cases table above it — one frame later
          so the tab's entry payload is the table alone. */}
      <Defer strategy="next-frame" placeholder={<div className="reveal-quiet min-h-[10rem]" aria-hidden />}>
        <LifecycleSection
          lifecycles={lifecycles}
          approveLifecycle={approveLifecycle}
          state={lifecyclesState}
          onChanged={loadLifecycles}
          focus={lifecycleFocus}
        />
      </Defer>
    </>
  );
}
