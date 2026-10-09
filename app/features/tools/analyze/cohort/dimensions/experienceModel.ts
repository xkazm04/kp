// The Experience page's track (WP4): a horizontal YEARS axis crossed by SENIORITY lanes, each
// member a mark at (years, lane), education a secondary mark beside it. Marks that would sit on
// top of each other in one lane stack into sub-rows (a deterministic beeswarm), so twenty people
// at "9 years, senior" stay twenty readable marks.
import type { CohortMember, CohortView } from "../cohortTypes.ts";
import { absentGroups, byNeutral, pctOn, pendingOn, type AbsentGroup } from "./dimensionModel.ts";

export const SENIORITY_LANES = ["lead", "senior", "medior", "junior", "unknown"] as const;
export type SeniorityLane = (typeof SENIORITY_LANES)[number];

export const EDUCATION_LEVELS = ["phd", "master", "bachelor", "secondary", "unknown"] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

/** Two marks closer than this (in % of the axis) share no sub-row. */
export const MIN_GAP_PCT = 7;

export function laneOf(seniority: string | null | undefined): SeniorityLane {
  const v = (seniority ?? "").trim().toLowerCase();
  if (/(lead|principal|staff|head|architect)/.test(v)) return "lead";
  if (/senior/.test(v)) return "senior";
  if (/(medior|mid|intermediate|regular)/.test(v)) return "medior";
  if (/(junior|entry|graduate|intern|trainee)/.test(v)) return "junior";
  return "unknown";
}

export function educationOf(level: string | null | undefined): EducationLevel {
  const v = (level ?? "").trim().toLowerCase();
  if (/(phd|doctor|doctorate)/.test(v)) return "phd";
  if (/(master|msc|mba|ing\b|mgr)/.test(v)) return "master";
  if (/(bachelor|bsc|\bba\b|bc\b)/.test(v)) return "bachelor";
  if (/(secondary|high.?school|maturita|vocational)/.test(v)) return "secondary";
  return "unknown";
}

export interface ExperienceMark {
  member: CohortMember;
  rating: number;
  years: number | null;
  lane: SeniorityLane;
  education: EducationLevel;
  /** % along the years axis; null = years not read (drawn in the axis's gutter). */
  x: number | null;
  /** Sub-row inside the lane, 0 = the lane's baseline. */
  stack: number;
}

export interface ExperienceModel {
  marks: ExperienceMark[];
  /** Lanes that hold at least one mark, top (lead) to bottom (unknown), with their sub-row count. */
  lanes: Array<{ lane: SeniorityLane; rows: number }>;
  axis: { max: number; ticks: number[] };
  pending: CohortMember[];
  absent: AbsentGroup[];
}

/** The axis runs 0 .. a multiple of 5 that holds everyone (at least 10 years). */
export function yearsAxis(years: readonly (number | null)[]): ExperienceModel["axis"] {
  const top = years.reduce<number>((acc, y) => (y != null && y > acc ? y : acc), 0);
  const max = Math.max(10, Math.ceil(top / 5) * 5);
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += max > 20 ? 5 : max > 10 ? 2 : 1) ticks.push(v);
  return { max, ticks };
}

/** Assign sub-rows lane by lane: years ascending (neutral tie-break), first row with room. */
export function stackMarks(marks: ExperienceMark[]): ExperienceMark[] {
  const out: ExperienceMark[] = [];
  for (const lane of SENIORITY_LANES) {
    const inLane = marks.filter((m) => m.lane === lane).sort((a, b) => (a.x ?? -1) - (b.x ?? -1) || byNeutral(a.member, b.member));
    const rows: number[][] = [];
    for (const m of inLane) {
      const x = m.x ?? -MIN_GAP_PCT;
      let r = rows.findIndex((xs) => xs.every((o) => Math.abs(o - x) >= MIN_GAP_PCT));
      if (r < 0) r = rows.push([]) - 1;
      rows[r].push(x);
      out.push({ ...m, stack: r });
    }
  }
  return out;
}

export function experienceModel(view: CohortView): ExperienceModel {
  const rated = view.members.filter((m) => m.cells.experience.rating != null);
  const axis = yearsAxis(rated.map((m) => m.detail.experience?.years ?? null));
  const raw: ExperienceMark[] = rated.map((m) => {
    const d = m.detail.experience;
    const years = d?.years ?? null;
    return {
      member: m,
      rating: m.cells.experience.rating as number,
      years,
      lane: laneOf(d?.seniority),
      education: educationOf(d?.educationLevel),
      x: years == null ? null : pctOn(years, 0, axis.max),
      stack: 0,
    };
  });
  const marks = stackMarks(raw);
  const lanes = SENIORITY_LANES.map((lane) => ({ lane, rows: marks.filter((m) => m.lane === lane).reduce((acc, m) => Math.max(acc, m.stack + 1), 0) })).filter((l) => l.rows > 0);
  return { marks, lanes, axis, pending: pendingOn(view, "experience"), absent: absentGroups(view, "experience") };
}
