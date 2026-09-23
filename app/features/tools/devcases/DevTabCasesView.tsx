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

/** The detail reader's record, read by id when a ledger row is opened (GET
 *  /api/devcase/[id]). The ledger rows are a projection - the design JSON the reader
 *  renders is no longer on the list - so this is the one fetch that brings it. A
 *  foreign or deleted id answers a coded 404, shown in the reader's language with the
 *  way back, rather than an empty reader. */
function CaseDetailById({ caseId, version, onBack, children }: {
  caseId: string;
  /** Re-read when the ledger reloads (a finished lifecycle step can materialize the
   *  seed or scenario this reader shows); the last good record stays up meanwhile. */
  version: number | null;
  onBack: () => void;
  children: (kase: DevCaseDetail) => ReactNode;
}) {
  const tDetail = useTranslations("devcase.studio.detail");
  const tErrors = useTranslations("errors");
  const errorMessage = useErrorMessage();
  const [loaded, setLoaded] = useState<{ id: string; kase: DevCaseDetail | null; error: string | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const r = await fetch(`/api/devcase/${encodeURIComponent(caseId)}`, { signal: controller.signal });
        const body = (await r.json().catch(() => null)) as { case?: DevCaseDetail; code?: string | null } | null;
        if (controller.signal.aborted) return;
        if (!r.ok || !body?.case) {
          setLoaded({ id: caseId, kase: null, error: errorMessage(body, tErrors("DEVCASE_CASE_LIST_FAILED")) });
          return;
        }
        setLoaded({ id: caseId, kase: body.case, error: null });
      } catch {
        // An abort is the reader leaving (or opening another row), not a failure;
        // anything else is named, with the way back.
        if (!controller.signal.aborted) {
          setLoaded({ id: caseId, kase: null, error: tErrors("DEVCASE_CASE_LIST_FAILED") });
        }
      }
    })();
    return () => controller.abort();
  }, [caseId, version, errorMessage, tErrors]);

  const current = loaded?.id === caseId ? loaded : null;
  if (current?.kase) return <>{children(current.kase)}</>;
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
  postings,
  selectedCaseId,
  onOpenCase,
  onBack,
  onDefine,
  publish,
  publishingCase,
  source,
  sourcing,
  sourcedCounts,
  loadPostings,
  approveLifecycle,
  loadLifecycles,
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
  postings: Posting[];
  selectedCaseId: string | null;
  onOpenCase: (id: string) => void;
  onBack: () => void;
  onDefine: () => void;
  publish: (caseId: string) => void;
  publishingCase: string | null;
  source: (caseId: string) => void;
  sourcing: string | null;
  sourcedCounts: Record<string, number>;
  loadPostings: () => void;
  approveLifecycle: (id: string) => void;
  loadLifecycles: () => void;
}) {
  if (selectedCaseId) {
    return (
      <CaseDetailById caseId={selectedCaseId} version={casesState.lastUpdated} onBack={onBack}>
        {(kase) => (
          <CaseDetail
            kase={kase}
            postings={postings}
            onBack={onBack}
            publish={publish}
            publishing={publishingCase === kase.id}
            source={source}
            sourcing={sourcing}
            sourcedCounts={sourcedCounts}
            loadPostings={loadPostings}
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
          postings={postings ?? []}
          approveLifecycle={approveLifecycle}
          state={lifecyclesState}
          onChanged={loadLifecycles}
        />
      </Defer>
    </>
  );
}
