import { candIdentity, type EvalCandidate, type GroupEvalPayload } from "@/app/features/shared/groupEvalTypes";

/** Is this candidate the crowned lead?
 *
 *  Keyed on the lead's stable entry id (candIdentity — the same identity the tabs, the
 *  decide map and the comparison columns use). The display label is NOT unique: with
 *  two same-named candidates the label test put the lead's "Unique strengths" chips on
 *  the rival's tab. Falls back to the label only for a payload sealed before topPick
 *  carried an id (and for the simulation's client-side eval), which is exactly the old
 *  behaviour for exactly the old payloads. */
export function isTopPick(c: EvalCandidate, topPick: GroupEvalPayload["topPick"]): boolean {
  if (!topPick) return false;
  return topPick.entryId ? candIdentity(c) === topPick.entryId : c.label === topPick.label;
}

/** Did this candidate FAIL a knock-out requirement?
 *
 *  ONE rule for every view. The enriched header enforces it (KO takes precedence over
 *  the crown, group-evaluation-fairness #1) while the legacy fallback — still reached by
 *  any payload without a score breakdown: a job-less role, an old saved eval, the
 *  simulation's loading payload — never rendered it at all, so a KO-failed candidate read
 *  there as an ordinary contender.
 *
 *  Explicit-false ONLY: an absent flag means the candidate was never assessed against the
 *  knock-outs, which is not the same fact as failing them (REC-03). */
export const koFailed = (c: EvalCandidate): boolean => c.koPassed === false;

// Returns the catalog key for the source pill; resolved through t() at the call site.
export const sourceLabelKey = (s?: string) => (s === "llm" ? "sourceLlm" : s === "partial" ? "sourcePartial" : "sourceDeterministic");

/** The "ran at" stamp, formatted in the APP's locale — not the browser's.
 *  A bare `toLocaleString()` follows the browser/OS locale, so a Czech workspace
 *  opened in an en-US browser stamped its localized modal with a US date. The
 *  locale is threaded from next-intl (useGroupEval → useLocale). */
export const ranWhen = (iso: string | null | undefined, locale: string): string | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString(locale) : null;
};

export const percentOf = (c: EvalCandidate, key: string) => c.scoreBreakdown?.find((d) => d.key === key)?.percent ?? null;

/** The value that wins a comparison row, or null when NOBODY wins it.
 *
 *  The leader wash is a claim ("this column leads the row"), so it must only appear
 *  when the row actually discriminates. Two states produce no leader:
 *    • every value is absent (null) — an all-unscored field. The row used to map
 *      absent → a -1 SENTINEL and take Math.max, and `-1 > -Infinity` passed, so the
 *      wash was painted on EVERY column of a row where nothing was measured.
 *    • every PRESENT value is identical — an exact tie is a tie, not a lead. (A single
 *      measured value among absent ones falls here too: the wash claims "this column
 *      beat the others", and an unscored column was never in the race.)
 *  A tie AT the top of an otherwise-varying row keeps the wash on each tied column:
 *  they genuinely share the lead, and the row still discriminates against the rest. */
export function rowLeader(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return null;
  if (present.every((v) => v === present[0])) return null;
  return Math.max(...present);
}
/** How many of the role's must-haves this candidate matched — or null when the
 *  candidate carries NO skill assessment at all.
 *
 *  The enriched table renders as soon as ONE column has a recruiter breakdown, and the
 *  ranker does not always produce a row per compared candidate (group-eval-run feeds it
 *  only entries it can resolve to a candidate record, and a row the ranker omits leaves
 *  `matchedSkills`/`missingSkills` undefined). Counting that absence as 0 printed a red
 *  "0/4" — a fabricated total miss for someone who was never measured — next to a row of
 *  neutral "not applicable" dashes SkillCell already draws for those very skills. An
 *  EMPTY assessment (`matchedSkills: []`) is a measured zero and still counts 0: absent
 *  and zero are different facts (REC-03), and only the absent one withholds the number. */
export const coverageCount = (c: EvalCandidate, mustRows: string[]): number | null =>
  c.matchedSkills == null && c.missingSkills == null ? null : mustRows.filter((s) => (c.matchedSkills ?? []).includes(s)).length;

/** Does the cross-scheme robust order agree with the headline fit order — or is the
 *  question unanswerable?
 *
 *  The fairness matrix does NOT always cover the whole compared field: the recruiter
 *  ranker is fed only the candidates it can resolve (group-eval-run drops an entry with
 *  no linked candidate record), while `headlineOrder` (payload.recommendedOrder) names
 *  EVERY compared column. The old inline test short-circuited on a length mismatch and
 *  fell through to the "agrees" copy — so a robust order computed over a SMALLER field,
 *  one that may well disagree, was reported to the recruiter as agreeing with a headline
 *  it had never been compared to. A legacy payload with no recommendedOrder at all
 *  (headlineOrder = []) hit the same false reassurance.
 *
 *  So: project the headline onto the matrix's OWN field and compare there. When the
 *  projection can't cover the matrix (a ranked label the headline never names), the
 *  comparison is unanswerable and this returns null — the panel then says nothing rather
 *  than claiming agreement it cannot establish. */
export function robustOrderVerdict(ranking: string[], headlineOrder: string[]): "agrees" | "diverges" | null {
  if (!ranking.length) return null;
  const inMatrix = new Set(ranking);
  const projected = headlineOrder.filter((l) => inMatrix.has(l));
  if (projected.length !== ranking.length) return null;
  return ranking.some((l, i) => l !== projected[i]) ? "diverges" : "agrees";
}

/** One score-breakdown row of the comparison table. `weight` is null when the compared
 *  columns do NOT share it — see buildDimRows. */
export type DimRow = { key: string; label: string; labelCode?: string; weight: number | null };

/** The score-breakdown rows: the union of the candidates' breakdown keys, in first-seen
 *  (server rank) order.
 *
 *  Both the LABEL and the WEIGHT on a breakdown dimension are PER CANDIDATE, not per row:
 *  the labels are archetype-aware (student/career_switcher rename skills→Foundation,
 *  career→Potential, personal→Fit — matching.dimension_labels) and so are the weights
 *  (matching.WEIGHTS: skills is 50% for bau, 40% for a student, 35% for a switcher). The
 *  row used to take both from whichever candidate happened to carry the key FIRST, so a
 *  mixed field — a student beside experienced candidates, exactly the field the fairness
 *  track exists for — headed the row "Foundation · weight 40%" while two of its three
 *  columns are Skills at 50%.
 *
 *  A fact the columns agree on stays; a disagreement degrades instead of picking a
 *  winner: the label falls back to the dimension's canonical catalog code (`key` IS
 *  match.dims.skills|career|personal) and the weight is dropped rather than stated for
 *  everyone. The per-candidate weight is still readable in full on that candidate's own
 *  tab (ScoreBreakdown). */
export function buildDimRows(candidates: EvalCandidate[]): DimRow[] {
  const rows = new Map<string, DimRow>();
  for (const c of candidates) {
    for (const d of c.scoreBreakdown ?? []) {
      const prev = rows.get(d.key);
      if (!prev) {
        rows.set(d.key, { key: d.key, label: d.label, labelCode: d.labelCode, weight: d.weight });
        continue;
      }
      if (prev.weight !== d.weight) prev.weight = null;
      if (prev.labelCode !== d.labelCode || prev.label !== d.label) {
        prev.label = d.key;
        prev.labelCode = d.key;
      }
    }
  }
  return [...rows.values()];
}

// Canonical skill rows: the role's requirements (must-have first), else the union
// of every matched/missing skill (a skill is "missing" only when must-have).
export function buildSkillRows(candidates: EvalCandidate[], requirements: { skill: string; kind: string }[]) {
  let rows: { skill: string; mustHave: boolean }[];
  if (requirements.length) {
    rows = requirements.map((r) => ({ skill: r.skill, mustHave: r.kind === "must_have" }));
  } else {
    const union = new Set<string>();
    const must = new Set<string>();
    for (const c of candidates) {
      (c.matchedSkills ?? []).forEach((s) => union.add(s));
      (c.missingSkills ?? []).forEach((s) => {
        union.add(s);
        must.add(s);
      });
    }
    rows = [...union].map((s) => ({ skill: s, mustHave: must.has(s) }));
  }
  rows.sort((a, b) => Number(b.mustHave) - Number(a.mustHave) || a.skill.localeCompare(b.skill));
  return { rows, mustRows: rows.filter((r) => r.mustHave).map((r) => r.skill) };
}

// SCOR3 — one place to assemble the explainable-potential payload off an eval
// candidate, so the two pill sites can't drift.
export function potentialOf(c: EvalCandidate) {
  return {
    score: c.potentialScore ?? 0,
    learningSignals: c.learningSignals,
    transferableSkills: c.transferableSkills,
    domainDistance: c.domainDistance,
  };
}
