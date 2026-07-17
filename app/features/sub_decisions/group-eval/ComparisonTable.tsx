import { useTranslations } from "next-intl";
import { Crown } from "lucide-react";
import { APP_CURRENCY, formatSalaryRange } from "@/app/_lib/format";
import { isSameCurrency } from "@/app/_lib/salary-band";
import {
  ConfidenceCell,
  CoverageCell,
  DimCell,
  FitCell,
  ProfileCell,
  SalaryCell,
  SkillCell,
  SkillsLegend,
  type SalaryScale,
} from "./ComparisonCells";
import { coverageCount, percentOf } from "./helpers";
import { Avatar, Pill, SectionTitle } from "./primitives";
import { candIdentity, type EvalCandidate } from "./types";

// ---- One comparison table (candidates = columns, attributes = grouped rows) ---
// Candidate identity lives ONLY in the sticky header; every section below reuses
// the same fixed column layout, so widths line up across Overview / Score / Skills
// / Salary and the eye scans straight down a candidate's column.

function CandidateHeader({ c, rank, isLead }: { c: EvalCandidate; rank: number; isLead: boolean }) {
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
// without hunting for the highest number.
function Row({
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

  // Salary: one shared scale across the role band + every SAME-CURRENCY expectation
  // so the bars are comparable column-to-column (and align, since columns are equal
  // width). The band is a bare [min, max] denominated in APP_CURRENCY by contract
  // (see format.ts); a cross-currency expectation (EUR vs a CZK band) is excluded
  // from the scale on purpose — mixing it in would distort every bar's position and
  // plot the outlier at a meaningless spot — and its cell shows an explicit "not
  // comparable" note instead (SalaryCell).
  const bandCurrency = APP_CURRENCY;
  const [lo, hi] = roleBand.length >= 2 ? [roleBand[0], roleBand[1]] : [0, 0];
  const withSalary = candidates.filter((c) => c.salaryExpectation);
  const comparableSalary = withSalary.filter((c) => isSameCurrency(c.salaryExpectation!.currency, bandCurrency));
  const showSalary = withSalary.length > 0 || hi > 0;
  const vals = [...(hi > 0 ? [lo, hi] : []), ...comparableSalary.flatMap((c) => [c.salaryExpectation!.minimum, c.salaryExpectation!.maximum])].filter((n) => n > 0);
  const loScale = vals.length ? Math.min(...vals) : 0;
  const hiScale = vals.length ? Math.max(...vals) : 1;
  const span = hiScale - loScale || 1;
  const sal: SalaryScale = { lo, hi, pct: (v) => Math.max(0, Math.min(100, ((v - loScale) / span) * 100)) };

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
