// The seeker's GitHub read as evidence - pure, so node:test pins it (githubEvidence.test.ts).
//
// Public work CORROBORATES, it never replaces (registry recruiting/public-work-evidence-
// bounding): the repositories add personal_project evidence beside the CV's own, and the
// matcher's consolidation keeps the STRONGEST basis per skill (transform.py
// build_match_candidate, strongest provenance rank) - so a skill the CV claims at work stays
// "work", a skill the CV only stated rises to personal-project standing, and a skill only
// the repositories show enters at that rung. Nothing is ever removed or lowered, and a
// seeker with no GitHub is read exactly as before.
//
// Two views, because the two readers want different things:
//   matcherProfile - every repository that showed a skill, once the seeker confirmed the
//                    account is theirs AND chose to use it; its updatedAt moves with that
//                    choice, so the scan's staleness rule (matchedAt >= updatedAt) re-scores.
//   cvProfile      - only the repositories the seeker picked for their CV's Projects
//                    section, one project entry each, named with the link a reader follows.
//
// The state lives in jobseeker_ui_state (kind 'github'), never in profile_json: every CV
// action replaces profile_json whole (jobseeker-cvs.ts makeJobseekerCvActive).

import type { ProfilePayload } from "@/app/features/shared/profileTypes";
import type { JobseekerProfile } from "./types";

/** One repository the snapshot holds (github.ts SeekerRepo, the fields read here). */
export type GithubRepoView = {
  name: string;
  fullName: string;
  htmlUrl: string;
  description: string | null;
  language: string | null;
  topics: string[];
  stars: number;
  pushedAt: string | null;
  createdAt: string | null;
  archived: boolean;
};

/** github_evidence_cli's evidence item: one repository that showed at least one skill. */
export type GithubEvidenceItem = {
  kind: "project";
  title: string;
  text: string;
  skills: string[];
  link: string;
  recency: string | null;
  provenance: "personal_project";
  repo: string;
};

/** github_evidence_cli's aggregate row: a skill, how many repositories show it. */
export type GithubSkillRow = { skill: string; termId: string | null; repos: number; lastPushedAt: string | null; corroborates: boolean };

export type GithubDerived = {
  evidence: GithubEvidenceItem[];
  skills: GithubSkillRow[];
  budget: { repos: number; languageReads: { planned: number; read: number }; partial: boolean; truncated: boolean };
};

/** What the store holds under kind 'github'. */
export type GithubState = {
  handle: string;
  login: string;
  name: string | null;
  htmlUrl: string;
  publicRepos: number;
  readAt: string;
  /** The seeker said this account is theirs (the identity gate). */
  confirmed: boolean;
  /** Use the repositories as evidence for matching. */
  use: boolean;
  /** Repository names chosen for the CV's Projects section, in the order shown. */
  projects: string[];
  repos: GithubRepoView[];
  derived: GithubDerived;
};

/** How many repositories the CV's Projects section may carry. */
export const GITHUB_PROJECTS_MAX = 6;

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const strs = (v: unknown, max: number, each: number): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, each)).filter((x): x is string => x !== null).slice(0, max) : [];
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function repoOf(v: unknown): GithubRepoView | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const name = str(r.name, 100);
  const htmlUrl = str(r.htmlUrl, 300);
  if (!name || !htmlUrl || !/^https:\/\/github\.com\//.test(htmlUrl)) return null;
  return {
    name,
    fullName: str(r.fullName, 200) ?? name,
    htmlUrl,
    description: str(r.description, 400),
    language: str(r.language, 60),
    topics: strs(r.topics, 20, 50),
    stars: num(r.stars),
    pushedAt: str(r.pushedAt, 40),
    createdAt: str(r.createdAt, 40),
    archived: r.archived === true,
  };
}

function evidenceOf(v: unknown): GithubEvidenceItem | null {
  if (!v || typeof v !== "object") return null;
  const e = v as Record<string, unknown>;
  const title = str(e.title, 160);
  const link = str(e.link, 300);
  const repo = str(e.repo, 100);
  const skills = strs(e.skills, 20, 60);
  if (!title || !link || !repo || skills.length === 0 || !/^https:\/\/github\.com\//.test(link)) return null;
  return { kind: "project", title, text: str(e.text, 1200) ?? "", skills, link, recency: str(e.recency, 7), provenance: "personal_project", repo };
}

function skillRowOf(v: unknown): GithubSkillRow | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  const skill = str(s.skill, 60);
  if (!skill) return null;
  return { skill, termId: str(s.termId, 80), repos: Math.max(0, Math.round(num(s.repos))), lastPushedAt: str(s.lastPushedAt, 40), corroborates: s.corroborates === true };
}

/** The stored value re-validated on the way out (a row is never trusted as typed). */
export function githubStateOf(value: unknown): GithubState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const handle = str(v.handle, 60);
  const login = str(v.login, 60);
  const htmlUrl = str(v.htmlUrl, 300);
  const readAt = str(v.readAt, 40);
  if (!handle || !login || !htmlUrl || !readAt) return null;
  const repos = Array.isArray(v.repos) ? v.repos.map(repoOf).filter((r): r is GithubRepoView => r !== null) : [];
  const d = (v.derived && typeof v.derived === "object" ? v.derived : {}) as Record<string, unknown>;
  const budget = (d.budget && typeof d.budget === "object" ? d.budget : {}) as Record<string, unknown>;
  const reads = (budget.languageReads && typeof budget.languageReads === "object" ? budget.languageReads : {}) as Record<string, unknown>;
  const names = new Set(repos.map((r) => r.name));
  return {
    handle,
    login,
    name: str(v.name, 120),
    htmlUrl,
    publicRepos: Math.max(0, Math.round(num(v.publicRepos))),
    readAt,
    confirmed: v.confirmed === true,
    use: v.use === true,
    projects: strs(v.projects, GITHUB_PROJECTS_MAX, 100).filter((n) => names.has(n)),
    repos,
    derived: {
      evidence: Array.isArray(d.evidence) ? d.evidence.map(evidenceOf).filter((e): e is GithubEvidenceItem => e !== null) : [],
      skills: Array.isArray(d.skills) ? d.skills.map(skillRowOf).filter((s): s is GithubSkillRow => s !== null) : [],
      budget: {
        repos: Math.max(0, Math.round(num(budget.repos))),
        languageReads: { planned: Math.max(0, Math.round(num(reads.planned))), read: Math.max(0, Math.round(num(reads.read))) },
        partial: budget.partial === true,
        truncated: budget.truncated === true,
      },
    },
  };
}

/** The repositories' evidence the matcher may read: only after the identity gate AND the
 *  seeker's own choice to use it. */
export function usableEvidence(state: GithubState | null): GithubEvidenceItem[] {
  return state && state.confirmed && state.use ? state.derived.evidence : [];
}

/** The profile the MATCHER reads (scan, deep-dive): the seeker's own plus the repositories'
 *  personal_project evidence. `stateUpdatedAt` is when the GitHub choice was last saved;
 *  the view's updatedAt is the later of the two, so turning GitHub on or off re-scores. */
export function matcherProfile(profile: JobseekerProfile, state: GithubState | null, stateUpdatedAt: string | null): JobseekerProfile {
  const extra = usableEvidence(state);
  // A choice saved at all (on OR off) is an input change the scores must follow.
  const touched = state && stateUpdatedAt && stateUpdatedAt > profile.updatedAt ? stateUpdatedAt : null;
  if (extra.length === 0 && !touched) return profile;
  const evidence = [
    ...(profile.profile.evidence ?? []),
    ...extra.map((e) => ({ kind: e.kind, title: e.title, text: e.text, skills: e.skills, link: e.link, provenance: e.provenance, recency: e.recency })),
  ];
  return { ...profile, profile: { ...profile.profile, evidence }, updatedAt: touched ?? profile.updatedAt };
}

/** Years of a repository's life as the CV prints them: "2024 – 2026", "2026". */
function yearsOf(repo: GithubRepoView): string | null {
  const from = repo.createdAt?.slice(0, 4) ?? null;
  const to = repo.pushedAt?.slice(0, 4) ?? null;
  if (from && to) return from === to ? to : `${from} – ${to}`;
  return to ?? from;
}

/** The profile the designed CV reads: the chosen repositories as Projects entries, each
 *  titled "name — github.com/owner/repo (years)" so the link a reader follows is printed
 *  text (a parser keeps it; cvDocument parses "Role — Org (dates)"), after the CV's own
 *  projects. Only what the repository says about itself: its description and its stack. */
export function cvProfile(profile: ProfilePayload, state: GithubState | null): ProfilePayload {
  if (!state || !state.confirmed || state.projects.length === 0) return profile;
  const byRepo = new Map(state.derived.evidence.map((e) => [e.repo, e]));
  const repos = new Map(state.repos.map((r) => [r.name, r]));
  const chosen = state.projects
    .map((name) => repos.get(name))
    .filter((r): r is GithubRepoView => !!r)
    .map((repo) => {
      const ev = byRepo.get(repo.name);
      const years = yearsOf(repo);
      const where = repo.htmlUrl.replace(/^https:\/\//, "");
      const stack = ev?.skills.length ? `Stack: ${ev.skills.join(", ")}.` : repo.language ? `Stack: ${repo.language}.` : "";
      // The repository's own sentence, closed, so the CV reads it as its own bullet and the
      // stack line after it as another (an open "Forget n8n" ran into "Stack: ...").
      const said = repo.description?.replace(/\s+/g, " ").trim() ?? "";
      const sentence = said && !/[.!?…]$/.test(said) ? `${said}.` : said;
      const text = [sentence, stack].filter(Boolean).join("\n");
      return {
        kind: "project",
        title: `${repo.name} — ${where}${years ? ` (${years})` : ""}`,
        text,
        skills: ev?.skills ?? (repo.language ? [repo.language] : []),
        link: repo.htmlUrl,
      };
    });
  if (chosen.length === 0) return profile;
  return { ...profile, evidence: [...(profile.evidence ?? []), ...chosen] };
}
