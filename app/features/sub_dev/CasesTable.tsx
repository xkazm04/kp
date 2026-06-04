"use client";

import { ChevronRight, ClipboardList } from "lucide-react";
import { LoadStatus } from "@/app/_components/LoadStatus";
import { formatRelativeTime } from "@/app/_lib/format";
import type { LoadState } from "@/app/_lib/useLoader";
import { STAGE_LABEL } from "./DevTypes";
import type { DevCaseDetail, Lifecycle, Posting } from "./DevTypes";

// Stage chip tint: production states (collecting onwards) read "live", the
// pre-publication states read neutral, the approval gate reads attention.
function stageChip(stage: string): string {
  if (stage === "awaiting_approval") return "bg-amber-100 text-amber-700";
  if (["published", "collecting", "ranked", "promoted"].includes(stage)) return "bg-moss/15 text-moss";
  return "bg-paper text-steel";
}

/** The Cases tab's first page: every designed assignment as one table row —
 *  stage comes from the case's lifecycle (when one drove it), submission counts
 *  from its postings. Row click opens the readable detail. */
export function CasesTable({
  cases,
  lifecycles,
  postings,
  state,
  onOpen,
  onDefine,
}: {
  cases: DevCaseDetail[];
  lifecycles: Lifecycle[];
  postings: Posting[];
  state: LoadState;
  onOpen: (id: string) => void;
  onDefine: () => void;
}) {
  if (cases.length === 0) {
    return (
      <div className="space-y-3">
        <LoadStatus state={state} label="dev cases" />
        <div className="rounded-lg border border-dashed border-stone-300 bg-white p-10 text-center">
          <ClipboardList size={22} className="mx-auto text-steel" aria-hidden />
          <p className="mt-2 text-base font-semibold text-ink">No cases yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-steel">
            A case is a designed work-sample assignment grounded in a real codebase. Define the need from a saved
            job description and the engine designs one for you.
          </p>
          <button
            type="button"
            onClick={onDefine}
            className="focus-ring mt-3 inline-flex h-9 items-center gap-1.5 rounded-md bg-coral px-3 text-base font-semibold text-white hover:opacity-90"
          >
            Define a need
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-panel">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-stone-200 bg-paper/60 text-micro font-semibold uppercase tracking-wide text-steel">
            <th scope="col" className="px-3 py-2">Assignment</th>
            <th scope="col" className="hidden px-3 py-2 md:table-cell">Role</th>
            <th scope="col" className="hidden px-3 py-2 sm:table-cell">Seniority</th>
            <th scope="col" className="px-3 py-2">Stage</th>
            <th scope="col" className="hidden px-3 py-2 sm:table-cell">Submissions</th>
            <th scope="col" className="hidden px-3 py-2 lg:table-cell">Created</th>
            <th scope="col" className="w-8 px-2 py-2"><span className="sr-only">Open</span></th>
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
                    {c.title || "Assignment"}
                  </button>
                  <p className="truncate text-micro text-steel md:hidden">{c.roleTitle}</p>
                </td>
                <td className="hidden max-w-0 truncate px-3 py-2.5 text-sm text-ink md:table-cell">{c.roleTitle ?? "—"}</td>
                <td className="hidden px-3 py-2.5 text-sm uppercase text-steel sm:table-cell">{c.seniority ?? "—"}</td>
                <td className="px-3 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-micro font-semibold uppercase ${stageChip(stage)}`}>
                    {STAGE_LABEL[stage] ?? stage}
                  </span>
                </td>
                <td className="hidden px-3 py-2.5 text-sm nums text-ink sm:table-cell">{submissions > 0 ? submissions : "—"}</td>
                <td className="hidden whitespace-nowrap px-3 py-2.5 text-sm text-steel lg:table-cell">{formatRelativeTime(c.createdAt)}</td>
                <td className="px-2 py-2.5 text-steel"><ChevronRight size={15} aria-hidden /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
