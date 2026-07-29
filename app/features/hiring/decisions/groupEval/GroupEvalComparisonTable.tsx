import { useTranslations } from "next-intl";
import { formatSalaryRange } from "@/app/_lib/format";
import {
  ConfidenceCell,
  CoverageCell,
  DimCell,
  FitCell,
  ProfileCell,
  SalaryCell,
  SkillCell,
  SkillsLegend,
} from "./GroupEvalComparisonCells";
import { coverageCount, percentOf } from "./groupEvalHelpers";
import { computeSalaryScale } from "./groupEvalSalaryScale";
import { CandidateHeader, GroupTr, Row, RowHead, SubGroupTr } from "./GroupEvalComparisonRows";
import { Pill, SectionTitle } from "./GroupEvalPrimitives";
import { candIdentity, type EvalCandidate } from "@/app/features/shared/groupEvalTypes";

// ---- One comparison table (candidates = columns, attributes = grouped rows) ---
// Candidate identity lives ONLY in the sticky header; every section below reuses
// the same fixed column layout, so widths line up across Overview / Score / Skills
// / Salary and the eye scans straight down a candidate's column. Row-level
// building blocks live in GroupEvalComparisonRows.tsx and the salary scale math
// in groupEvalSalaryScale.ts — split out to keep this file under 200 lines.

export function ComparisonTable({
  candidates,
  skillRows,
  mustRows,
  roleBand,
  hasLead,
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
}) {
  const t = useTranslations("decisions.groupEval");
  const cols = candidates.length + 1;

  // Dimension rows: union of breakdown keys (skills/career/personal), labelled
  // from the first candidate that carries each (archetype-aware labels).
  const dims: { key: string; label: string; weight: number }[] = [];
  const seenDim = new Set<string>();
  for (const c of candidates) {
    for (const d of c.scoreBreakdown ?? []) {
      if (!seenDim.has(d.key)) {
        seenDim.add(d.key);
        dims.push({ key: d.key, label: d.label, weight: d.weight });
      }
    }
  }

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
                  <CandidateHeader c={c} rank={i + 1} isLead={hasLead && i === 0} />
                </th>
              ))}
            </tr>
          </thead>

          {/* Overview */}
          <tbody>
            <GroupTr label={t("overview")} cols={cols} />
            {/* Unscored → -1 for the leader tint only (an absent score can never win the row). */}
            <Row head={<RowHead title={t("overallFit")} />} candidates={candidates} leaderValue={(c) => c.score ?? -1} render={(c) => <FitCell c={c} />} />
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
                  head={<RowHead title={d.label} sub={t("weight", { weight: d.weight })} />}
                  candidates={candidates}
                  leaderValue={(c) => percentOf(c, d.key) ?? -1}
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
                aside={hi > 0 ? <Pill tone="info">{t("roleBand", { range: formatSalaryRange(lo, hi, { currency: bandCurrency }) })}</Pill> : <Pill>{t("noRoleBand")}</Pill>}
              />
              <Row head={<RowHead title={t("expected")} sub={t("salaryLegend")} />} candidates={candidates} render={(c) => <SalaryCell c={c} sal={sal} bandCurrency={bandCurrency} />} />
            </tbody>
          ) : null}
        </table>
      </div>
    </section>
  );
}
