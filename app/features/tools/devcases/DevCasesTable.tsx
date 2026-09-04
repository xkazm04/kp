"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { StatusChip, StatusLegend } from "@/app/_components/StatusChip";
import { DIVIDER, PANEL } from "@/app/_components/ui/recipes";
import { assignmentStageTone } from "@/app/_lib/status-tone";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import type { LoadState } from "@/app/_lib/useLoader";
import { CasesEmpty } from "./DevCasesEmpty";
import { useStageLabel } from "./DevLabels";
import type { DevCaseDetail, Lifecycle, Posting } from "./DevTypes";

// ONE THREAD (gap 8) — the local `stageChip` tint table is gone. It knew three
// states (approval gate = amber, LIVE_STAGES = moss, everything else = paper) and
// so collapsed `intake` and `closed` into the same neutral chip while painting the
// approval gate the same amber a closed JOB used one tab away. Tone now comes from
// the shared per-axis table in app/_lib/status-tone.ts, which is exhaustive over
// all ten orchestrator stages and pinned to that producer by its own test.

/** The Cases tab's first page: every designed assignment as one table row —
 *  stage comes from the case's lifecycle (when one drove it), submission counts
 *  from its postings. Row click opens the readable detail. */
export function CasesTable({
  cases,
  truncated,
  lifecycles,
  postings,
  state,
  onOpen,
  onDefine,
}: {
  cases: DevCaseDetail[];
  /** The server cut the page (GET /api/devcase answers `truncated`). Said out loud
   *  below: a list that silently stops at its page size is indistinguishable from a
   *  studio that has exactly that many cases. */
  truncated: boolean;
  lifecycles: Lifecycle[];
  postings: Posting[];
  state: LoadState;
  onOpen: (id: string) => void;
  onDefine: () => void;
}) {
  const rel = useRelativeTime();
  const t = useTranslations("devcase.casesTable");
  const stageLabel = useStageLabel();
  // Tier 2 (docs/design/loading-choreography.md): useLoader's `data` starts as `[]`, so
  // an empty list is ambiguous between "still loading" and "genuinely no cases
  // yet" — `state.lastUpdated` disambiguates. Never loaded + healthy: hold the
  // table's height, invisibly, rather than jumping straight to the empty state.
  if (cases.length === 0 && state.lastUpdated == null && !state.failed) {
    return <div className="reveal-quiet min-h-[16rem]" aria-hidden />;
  }
  // First-run empty list. CasesEmpty renders the sealed-ledger variant directly —
  // the local prototype switcher this comment used to describe is gone, so what
  // DevCasesEmptyLedger says about the controls IS the shipped marketing surface.
  if (cases.length === 0) {
    return <CasesEmpty state={state} onDefine={onDefine} />;
  }

  return (
    <div className={`overflow-hidden ${PANEL}`}>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-stone-200 bg-paper/60 text-micro font-semibold uppercase tracking-wide text-steel">
            <th scope="col" className="px-3 py-2">{t("colAssignment")}</th>
            <th scope="col" className="hidden px-3 py-2 md:table-cell">{t("colRole")}</th>
            <th scope="col" className="hidden px-3 py-2 sm:table-cell">{t("colSeniority")}</th>
            <th scope="col" className="px-3 py-2">{t("colStage")}</th>
            <th scope="col" className="hidden px-3 py-2 sm:table-cell">{t("colSubmissions")}</th>
            <th scope="col" className="hidden px-3 py-2 lg:table-cell">{t("colCreated")}</th>
            <th scope="col" className="w-8 px-2 py-2"><span className="sr-only">{t("open")}</span></th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c, i) => {
            const lc = lifecycles.find((l) => l.caseId === c.id);
            const casePostings = postings.filter((p) => p.caseId === c.id);
            const submissions = casePostings.reduce((n, p) => n + (p.submissions?.length ?? p.submissionCount ?? 0), 0);
            const stage = lc?.stage ?? (casePostings.length > 0 ? "published" : "approved");
            return (
              <tr
                key={c.id}
                onClick={() => onOpen(c.id)}
                style={{ animationDelay: `${i * 30}ms` }}
                className="animate-fade-in cursor-pointer border-b border-stone-100 transition-colors last:border-b-0 hover:bg-paper/50 motion-reduce:animate-none"
              >
                <td className="max-w-0 px-3 py-2.5">
                  {/* the focusable element for keyboard users — the whole row stays clickable for pointers */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(c.id);
                    }}
                    className="focus-ring block w-full truncate rounded text-left text-base font-semibold text-ink hover:text-coral"
                  >
                    {c.title || t("untitledAssignment")}
                  </button>
                  <p className="truncate text-micro text-steel md:hidden">{c.roleTitle}</p>
                </td>
                <td className="hidden max-w-0 truncate px-3 py-2.5 text-sm text-ink md:table-cell">{c.roleTitle ?? "—"}</td>
                <td className="hidden px-3 py-2.5 text-sm uppercase text-steel sm:table-cell">{c.seniority ?? "—"}</td>
                <td className="px-3 py-2.5">
                  <StatusChip
                    tone={assignmentStageTone(stage)}
                    label={stageLabel(stage)}
                    ariaLabel={t("stageAria", { stage: stageLabel(stage) })}
                    className="uppercase"
                  />
                </td>
                <td className="hidden px-3 py-2.5 text-sm nums text-ink sm:table-cell">{submissions > 0 ? submissions : "—"}</td>
                <td className="hidden whitespace-nowrap px-3 py-2.5 text-sm text-steel lg:table-cell">{rel(c.createdAt)}</td>
                <td className="px-2 py-2.5 text-steel"><ChevronRight size={15} aria-hidden /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* ONE THREAD (gap 8) — the legend lives here because this is the axis with
          TEN values: the reader most needs to be told that "designed" and
          "collecting" are the same kind of state, and that "awaiting approval" is
          the one that is about them. Same component, same five words, on every
          surface that carries a status chip. */}
      {truncated ? (
        <p role="status" className={`${DIVIDER} bg-paper/40 px-3 py-2 text-micro text-steel`}>
          {t("truncated", { count: cases.length })}
        </p>
      ) : null}
      <StatusLegend className={`${DIVIDER} bg-paper/40 px-3 py-2`} />
    </div>
  );
}
