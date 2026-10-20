// The Skills page's coverage grid (WP4): rows = the UNION of the role's required skills as the
// members' analyses read them (matched ∪ missing ∪ unproven, case-insensitive), columns = the
// members. Rows are sorted so the skills that DISCRIMINATE come first: the most members lacking
// it, then the most claimed-but-unproven, then by name. A skill every member has is the least
// informative row and sinks to the bottom.
import type { CohortMember, CohortView } from "../cohortTypes.ts";
import { byNeutral } from "./dimensionModel.ts";

/** matched / unproven / missing as the analysis read it; `unlisted` = this member's analysis
 *  did not list the skill at all (not read for them, never a "missing"). */
export const SKILL_MARKS = ["matched", "unproven", "missing", "unlisted"] as const;
export type SkillMark = (typeof SKILL_MARKS)[number];

export interface SkillRow {
  key: string;
  /** The first spelling met, in column order. */
  label: string;
  marks: Record<string, SkillMark>;
  missing: number;
  unproven: number;
  matched: number;
}

export interface SkillsModel {
  /** Every member: rated by skills rating desc (neutral tie-break), then pending, then absent. */
  columns: CohortMember[];
  rows: SkillRow[];
  /** Skills on each CV the role did not ask for, by memberId (members with a read skill list only). */
  extra: Record<string, string[]>;
}

const norm = (s: string): string => s.trim().toLowerCase();

export function skillColumns(view: CohortView): CohortMember[] {
  const rated = view.members.filter((m) => m.cells.skills.rating != null);
  rated.sort((a, b) => (b.cells.skills.rating as number) - (a.cells.skills.rating as number) || byNeutral(a, b));
  const pending = view.members.filter((m) => m.cells.skills.absentReason === "pending").sort(byNeutral);
  const absent = view.members.filter((m) => m.cells.skills.rating == null && m.cells.skills.absentReason !== "pending").sort(byNeutral);
  return [...rated, ...pending, ...absent];
}

export function skillRows(columns: readonly CohortMember[]): SkillRow[] {
  const rows = new Map<string, SkillRow>();
  const read = columns.filter((m) => m.detail.skills);
  for (const m of read) {
    const d = m.detail.skills!;
    const put = (skill: string, mark: SkillMark) => {
      const key = norm(skill);
      if (!key) return;
      const row = rows.get(key) ?? { key, label: skill.trim(), marks: {}, missing: 0, unproven: 0, matched: 0 };
      // The strongest reading wins when an analysis lists a skill twice (matched > unproven > missing).
      const prior = row.marks[m.memberId];
      if (prior && SKILL_MARKS.indexOf(prior) <= SKILL_MARKS.indexOf(mark)) return;
      row.marks[m.memberId] = mark;
      rows.set(key, row);
    };
    d.matched.forEach((s) => put(s, "matched"));
    d.unproven.forEach((s) => put(s, "unproven"));
    d.missing.forEach((s) => put(s, "missing"));
  }
  for (const row of rows.values()) {
    for (const m of read) if (!row.marks[m.memberId]) row.marks[m.memberId] = "unlisted";
    const marks = Object.values(row.marks);
    row.missing = marks.filter((k) => k === "missing").length;
    row.unproven = marks.filter((k) => k === "unproven").length;
    row.matched = marks.filter((k) => k === "matched").length;
  }
  return [...rows.values()].sort(
    (a, b) => b.missing - a.missing || b.unproven - a.unproven || a.label.localeCompare(b.label, "en", { sensitivity: "base" })
  );
}

export function skillsModel(view: CohortView): SkillsModel {
  const columns = skillColumns(view);
  const extra: Record<string, string[]> = {};
  for (const m of columns) if (m.detail.skills) extra[m.memberId] = m.detail.skills.extra;
  return { columns, rows: skillRows(columns), extra };
}
