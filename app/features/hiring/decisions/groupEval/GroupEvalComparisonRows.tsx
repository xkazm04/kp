import { useTranslations } from "next-intl";
import { Crown } from "lucide-react";
import { Avatar, Pill } from "./GroupEvalPrimitives";
import { candIdentity, type EvalCandidate } from "@/app/features/shared/groupEvalTypes";

// Row-level building blocks for GroupEvalComparisonTable — the sticky
// candidate-header cell, section/subsection dividers, and the generic
// label-cell-plus-per-candidate-value row. Split out to keep the table
// component under the 200-line cap.

export function CandidateHeader({ c, rank, isLead }: { c: EvalCandidate; rank: number; isLead: boolean }) {
  const t = useTranslations("decisions.groupEval");
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink/85 text-sm font-semibold text-white tabular-nums">{rank}</span>
      <Avatar label={c.label} archetype={c.archetype} size="sm" />
      <div className="min-w-0">
        <div className="truncate font-semibold text-ink">{c.label}</div>
        {/* KO takes precedence over the crown (group-evaluation-fairness #1): a
            KO-failed candidate must never be shown as the lead, and the crown must
            never suppress the KO pill. isLead is only ever true when the server
            actually crowned a lead (see `hasLead`), so a legitimate lead never hits
            the KO branch. */}
        {c.koPassed === false ? (
          <Pill tone="coral">{t("ko")}</Pill>
        ) : isLead ? (
          <Pill tone="moss">
            <Crown size={12} /> {t("lead")}
          </Pill>
        ) : null}
      </div>
    </div>
  );
}

export function GroupTr({ label, cols, aside }: { label: string; cols: number; aside?: React.ReactNode }) {
  return (
    <tr className="bg-paper/60">
      <td colSpan={cols} className="border-y border-stone-200 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="h-3.5 w-1 rounded-full bg-coral/50" aria-hidden />
          <span className="text-sm font-semibold uppercase tracking-wide text-steel">{label}</span>
          {aside}
        </div>
      </td>
    </tr>
  );
}

export function SubGroupTr({ label, cols }: { label: string; cols: number }) {
  return (
    <tr className="bg-paper/30">
      <td colSpan={cols} className="px-3 py-1 text-sm font-semibold uppercase tracking-wide text-steel">
        {label}
      </td>
    </tr>
  );
}

export function RowHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <span className="block text-sm font-semibold uppercase tracking-wide text-steel">{title}</span>
      {sub ? <span className="block text-sm font-normal normal-case text-steel">{sub}</span> : null}
    </>
  );
}

// A generic comparison row: a sticky label cell + one value cell per candidate.
// `leaderValue` (when given) tints the winning cell so the column comparison reads
// without hunting for the highest number.
export function Row({
  head,
  candidates,
  render,
  leaderValue,
}: {
  head: React.ReactNode;
  candidates: EvalCandidate[];
  render: (c: EvalCandidate, isLeader: boolean) => React.ReactNode;
  leaderValue?: (c: EvalCandidate) => number;
}) {
  const leader = leaderValue && candidates.length > 1 ? Math.max(...candidates.map(leaderValue)) : null;
  return (
    <tr className="border-b border-stone-100 last:border-0">
      <th scope="row" className="sticky left-0 z-10 bg-white px-3 py-2 text-left align-middle">
        {head}
      </th>
      {candidates.map((c) => {
        const isLeader = leader != null && leader > -Infinity && leaderValue!(c) === leader;
        // Leader wash is stronger in dark — /5 moss vanishes against the dark
        // surface; /15 plus a moss edge keeps the front-runner column scannable.
        return (
          <td key={candIdentity(c)} className={`px-3 py-2 align-middle ${isLeader ? "bg-moss/5 dark:bg-moss/15 dark:shadow-[inset_2px_0_0_var(--color-moss)]" : ""}`}>
            {render(c, isLeader)}
          </td>
        );
      })}
    </tr>
  );
}
