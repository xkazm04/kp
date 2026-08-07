"use client";

// The "Cases" sub-tab: case detail reader OR the cases table + automated-lifecycle
// list, split out of DevTab.tsx. Owns the CaseDetail/LifecycleSection dynamic
// imports since both are only ever needed from this view.
import dynamic from "next/dynamic";
import { Defer } from "@/app/_components/ui/Defer";
import type { LoadState } from "@/app/_lib/load-state";
import { CasesTable } from "./DevCasesTable";
import type { DevCaseDetail, Lifecycle, Posting } from "./DevTypes";

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

export function DevTabCasesView({
  cases,
  casesState,
  lifecycles,
  lifecyclesState,
  postings,
  selectedCase,
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
  cases: DevCaseDetail[];
  casesState: LoadState;
  lifecycles: Lifecycle[];
  lifecyclesState: LoadState;
  postings: Posting[];
  selectedCase: DevCaseDetail | null;
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
  if (selectedCase) {
    return (
      <CaseDetail
        kase={selectedCase}
        postings={postings}
        onBack={onBack}
        publish={publish}
        publishing={publishingCase === selectedCase.id}
        source={source}
        sourcing={sourcing}
        sourcedCounts={sourcedCounts}
        loadPostings={loadPostings}
      />
    );
  }
  return (
    <>
      <CasesTable
        cases={cases}
        lifecycles={lifecycles}
        postings={postings}
        state={casesState}
        onOpen={onOpenCase}
        onDefine={onDefine}
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
