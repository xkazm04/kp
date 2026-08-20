import { Crown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useNumberFormat } from "@/app/_lib/use-number-format";
import {
  ConfidenceCell,
  CoverageCell,
  DimCell,
  FitCell,
  ProfileCell,
  SalaryCell,
  SkillCell,
  SkillsLegend,
} from "@/app/features/hiring/decisions/groupEval/GroupEvalComparisonCells";
import { buildDimRows, coverageCount, percentOf, rowLeader, type DimRow } from "@/app/features/hiring/decisions/groupEval/groupEvalHelpers";
import { useMatchLabels } from "@/app/features/shared/matchLabels";
import { computeSalaryScale } from "@/app/features/hiring/decisions/groupEval/groupEvalSalaryScale";
import { Avatar, Pill, SectionTitle } from "@/app/features/hiring/decisions/groupEval/GroupEvalPrimitives";
import { candIdentity, type EvalCandidate } from "@/app/features/shared/groupEvalTypes";

// ---- One comparison table (candidates = columns, attributes = grouped rows) ---
// Candidate identity lives ONLY in the sticky header; every section below reuses
// the same fixed column layout, so widths line up across Overview / Score / Skills
// / Salary and the eye scans straight down a candidate's column.

function CandidateHeader({ c, rank, isLead, tiedLead }: { c: EvalCandidate; rank: number; isLead: boolean; tiedLead: boolean }) {
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
          // The crown, and — when the payload says so — the hedge that belongs beside
          // it. leadSeparation "overlapping" means the gap to the runner-up is inside
          // both confidence bands; it was computed and SEALED into the audit record but
          // rendered nowhere, because the summary prose carrying it is discarded by
          // AiVerdict whenever an LLM comparison exists. A recruiter must not read a
          // confident crown the audit record itself hedges.
          <span className="flex flex-wrap items-center gap-1">
            <Pill tone="moss">
              <Crown size={12} /> {t("lead")}
            </Pill>
            {tiedLead ? (
              <Pill tone="amber" title={t("leadTiedTitle")}>
                {t("leadTied")}
              </Pill>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function GroupTr({ label, cols, aside }: { label: string; cols: number; aside?: React.ReactNode }) {
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

function SubGroupTr({ label, cols }: { label: string; cols: number }) {
  return (
    <tr className="bg-paper/30">
      <td colSpan={cols} className="px-3 py-1 text-sm font-semibold uppercase tracking-wide text-steel">
        {label}
      </td>
    </tr>
  );
}

function RowHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <span className="block text-sm font-semibold uppercase tracking-wide text-steel">{title}</span>
      {sub ? <span className="block text-sm font-normal normal-case text-steel">{sub}</span> : null}
    </>
  );
}

// A generic comparison row: a sticky label cell + one value cell per candidate.
// `leaderValue` (when given) tints the winning cell so the column comparison reads
// without hunting for the highest number. It returns null for an ABSENT value (an
// unscored candidate, a missing breakdown dimension) — never a sentinel number:
// rowLeader then withholds the wash entirely on a row nobody wins (all absent, or
// an exact tie across the board) instead of washing every column.
function Row({
  head,
  candidates,
  render,
  leaderValue,
}: {
  head: React.ReactNode;
  candidates: EvalCandidate[];
  render: (c: EvalCandidate, isLeader: boolean) => React.ReactNode;
  leaderValue?: (c: EvalCandidate) => number | null;
}) {
  const leader = leaderValue && candidates.length > 1 ? rowLeader(candidates.map(leaderValue)) : null;
  return (
    <tr className="border-b border-stone-100 last:border-0">
      <th scope="row" className="sticky left-0 z-10 bg-white px-3 py-2 text-left align-middle">
        {head}
      </th>
      {candidates.map((c) => {
        const isLeader = leader != null && leaderValue!(c) === leader;
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

export function ComparisonTable({
  candidates,
  skillRows,
  mustRows,
  roleBand,
  hasLead,
  leadSeparation,
}: {
  candidates: EvalCandidate[];
  skillRows: { skill: string; mustHave: boolean }[];
  mustRows: string[];
  roleBand: number[];
  // Did the server actually crown a lead (topPick)? When false — an all-KO field or
  // a sub-min-cohort sample — NO column gets the "Lead" crown, matching the summary
  // and the sealed record (group-evaluation-fairness #1). The lead, when present, is
  // always the rank-1 (first) column.
  hasLead: boolean;
  // Does the crown survive both top candidates' confidence bands? "overlapping" — the
  // top two are a tie on the evidence — renders an "effectively tied" chip beside the
  // crown. Absent (legacy payload) or "unknown"/"separated" renders no extra chrome:
  // an unassessable separation must never read as either reassurance or a hedge.
  leadSeparation?: "separated" | "overlapping" | "unknown";
}) {
  const t = useTranslations("decisions.groupEval");
  // Reader-locale digit grouping (format.ts number-locale contract).
  const n = useNumberFormat();
  const { dimLabel } = useMatchLabels();
  const cols = candidates.length + 1;

  // Dimension rows: union of breakdown keys (skills/career/personal). The label and the
  // weight are per-CANDIDATE facts (both archetype-aware), so buildDimRows only states
  // the ones every column agrees on — a mixed field used to head the row with one
  // candidate's rename and one candidate's weight.
  const dims = buildDimRows(candidates);
  // …and the name is localized through the shared match.dims resolver, like every other
  // match surface: only label/labelCode are read, so the numeric fields below are inert
  // placeholders (a row header is not a candidate's measurement).
  const dimName = (d: DimRow) => dimLabel({ ...d, weight: 0, percent: 0, contribution: 0 });

  const must = skillRows.filter((r) => r.mustHave);
  const nice = skillRows.filter((r) => !r.mustHave);

  const { bandCurrency, lo, hi, showSalary, sal } = computeSalaryScale(candidates, roleBand);

  return (
    <section>
      <SectionTitle>{t("comparison")}</SectionTitle>
      <div className="mt-2 overflow-x-auto rounded-xl border border-stone-200">
        <table className="w-full min-w-[60rem] table-fixed border-collapse text-base">
          <colgroup>
            <col className="w-[12.5rem]" />
            {candidates.map((c) => (
              <col key={candIdentity(c)} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 top-0 z-30 border-b border-stone-200 bg-paper px-3 py-2 text-left align-bottom text-sm font-semibold uppercase tracking-wide text-steel"
              >
                {t("candidateHeader")}
              </th>
              {candidates.map((c, i) => (
                <th key={candIdentity(c)} scope="col" className="sticky top-0 z-20 border-b border-stone-200 bg-paper px-3 py-2 text-left align-bottom font-normal">
                  <CandidateHeader c={c} rank={i + 1} isLead={hasLead && i === 0} tiedLead={leadSeparation === "overlapping"} />
                </th>
              ))}
            </tr>
          </thead>

          {/* Overview */}
          <tbody>
            <GroupTr label={t("overview")} cols={cols} />
            {/* An unscored candidate reports null — absent, not a sentinel — so it can
                never win the row AND an all-unscored row crowns nobody. */}
            <Row head={<RowHead title={t("overallFit")} />} candidates={candidates} leaderValue={(c) => c.score} render={(c) => <FitCell c={c} />} />
            <Row head={<RowHead title={t("confidenceBand")} />} candidates={candidates} render={(c) => <ConfidenceCell c={c} />} />
            <Row head={<RowHead title={t("profile")} />} candidates={candidates} render={(c) => <ProfileCell c={c} />} />
            {mustRows.length ? (
              <Row
                head={<RowHead title={t("mustHaveCoverage")} />}
                candidates={candidates}
                leaderValue={(c) => coverageCount(c, mustRows)}
                render={(c) => <CoverageCell c={c} mustRows={mustRows} />}
              />
            ) : null}
          </tbody>

          {/* Score breakdown */}
          {dims.length ? (
            <tbody>
              <GroupTr label={t("scoreBreakdownSection")} cols={cols} />
              {dims.map((d) => (
                <Row
                  key={d.key}
                  head={<RowHead title={dimName(d)} sub={d.weight != null ? t("weight", { weight: d.weight }) : undefined} />}
                  candidates={candidates}
                  leaderValue={(c) => percentOf(c, d.key)}
                  render={(c, isLeader) => <DimCell c={c} dimKey={d.key} isLeader={isLeader} />}
                />
              ))}
            </tbody>
          ) : null}

          {/* Skills */}
          {skillRows.length ? (
            <tbody>
              <GroupTr label={t("skillsSection")} cols={cols} aside={<SkillsLegend />} />
              {must.length ? <SubGroupTr label={t("mustHaveCount", { n: must.length })} cols={cols} /> : null}
              {must.map((r) => (
                <Row key={r.skill} head={<span className="font-medium text-ink">{r.skill}</span>} candidates={candidates} render={(c) => <SkillCell skill={r.skill} c={c} />} />
              ))}
              {nice.length ? <SubGroupTr label={t("niceToHaveCount", { n: nice.length })} cols={cols} /> : null}
              {nice.map((r) => (
                <Row key={r.skill} head={<span className="font-medium text-ink">{r.skill}</span>} candidates={candidates} render={(c) => <SkillCell skill={r.skill} c={c} />} />
              ))}
            </tbody>
          ) : null}

          {/* Salary */}
          {showSalary ? (
            <tbody>
              <GroupTr
                label={t("salarySection")}
                cols={cols}
                aside={hi > 0 ? <Pill tone="info">{t("roleBand", { range: n.salaryRange(lo, hi, { currency: bandCurrency }) })}</Pill> : <Pill>{t("noRoleBand")}</Pill>}
              />
              <Row head={<RowHead title={t("expected")} sub={t("salaryLegend")} />} candidates={candidates} render={(c) => <SalaryCell c={c} sal={sal} bandCurrency={bandCurrency} />} />
            </tbody>
          ) : null}
        </table>
      </div>
    </section>
  );
}
