// Builds the walkthrough's fixture (public/dev/cohort/walkthrough.json): the role library, the
// proposal per role and the add control's population, DERIVED from the engine's committed
// output (cohort20.done.json) plus the seed job corpus the engine fixture is built from.
//
//   node --experimental-transform-types app/features/tools/analyze/cohort/fixture/buildWalkthroughFixture.ts
//
// Only ids, labels, membership, the fixture's member ORDER and its reused flag are taken from the
// cohort fixture: every analysed fact the walkthrough draws is read from cohort20.*.json at
// runtime (loadCohortFixture), so a regenerated engine fixture never goes stale here.
// Deterministic: no clock, no randomness — walkthroughFixture.test.ts pins the file to this.
//
// The cast (decided by the round-2 brief): the proposal seats all 8 applicants and the first 8
// matched in the fixture's pool-rank order — 16. The other 4 runnable members (2 matched + the 2
// the fixture added by hand) are the add control's population, so adding them reaches the cap of
// 20 and every member the walkthrough can run exists in the finished fixture.
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { COHORT_CAP, type CohortProposal, type CohortView, type MemberSource, type ProposalMember } from "../cohortTypes.ts";
import type { PopulationLite } from "../cohortProposalEdits.ts";
import type { WalkthroughFixture } from "../cohortWalkthroughModel.ts";
import type { CohortRole } from "../useCohortLists.ts";

const ROOT = new URL("../../../../../../", import.meta.url);
const DONE = "public/dev/cohort/cohort20.done.json";
const JOBS = "data/seed_jobs/jobs.json";
export const WALKTHROUGH_PATH = "public/dev/cohort/walkthrough.json";

type SeedJob = { id: string; title: string; company: string; seniority: string; role_family: string };

/** The cohort's own role in the seed corpus (buildFixture.ts compares everyone against it). */
const COHORT_JOB = "job-000";
/** Other roles of the same employer the picker lists; none has a candidate yet. `pipeline`
 *  null = an analysis-only JD (no pipeline yet), 0 = a pipeline nobody is in. */
const OTHER_ROLES: Array<{ id: string; pipeline: 0 | null }> = [
  { id: "job-013", pipeline: 0 },
  { id: "job-005", pipeline: null },
  { id: "job-022", pipeline: 0 },
  { id: "job-011", pipeline: null },
  { id: "job-007", pipeline: null },
];
/** How many matched members the proposal seats (the rest join the population). */
export const PROPOSED_MATCHED = 8;
/**
 * The fixture records the pool rank as ORDER only; the walkthrough stamps a descending score on
 * that order so the tray reads the way the live one does ("match 88"). Applicants carry none
 * (the live tray says "applied, not ranked").
 */
const MATCH_TOP = 88;
const MATCH_STEP = 3;
/** Fixed creation stamps: the cohort's role newest, the others a day apart before it. */
const CREATED = Date.UTC(2026, 9, 8, 9, 0, 0);
const DAY = 86_400_000;

const PROFILE = "profile:";

export function slugOf(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const sourceOf = (memberId: string): MemberSource =>
  memberId.startsWith(PROFILE) ? { kind: "profile", id: memberId.slice(PROFILE.length) } : { kind: "analysis", slug: memberId };

/** The live proposal's cap rule (analyze-cohort-proposal.ts `take`): seat in order until the cap, count the rest by rule. */
function seat(ordered: ProposalMember[]): { members: ProposalMember[]; leftOut: CohortProposal["leftOut"] } {
  const leftOut = { applicants: 0, matched: 0 };
  const members: ProposalMember[] = [];
  for (const m of ordered) {
    if (members.length < COHORT_CAP) members.push(m);
    else if (m.membership === "applicant") leftOut.applicants += 1;
    else leftOut.matched += 1;
  }
  return { members, leftOut };
}

function proposal(slug: string, title: string, orgName: string | null, ordered: ProposalMember[]): CohortProposal {
  const { members, leftOut } = seat(ordered);
  return {
    jdSlug: slug,
    jdTitle: title,
    // composeCompanyText(org, job.company) when both name the same employer: the org's name alone.
    companyText: orgName,
    orgName,
    members,
    leftOut,
    cap: COHORT_CAP,
    freshCount: members.filter((m) => !m.reusable).length,
  };
}

export function buildWalkthroughFixture(done: CohortView, jobs: SeedJob[]): WalkthroughFixture {
  const job = (id: string): SeedJob => {
    const j = jobs.find((x) => x.id === id);
    if (!j) throw new Error(`buildWalkthroughFixture: ${id} is missing from ${JOBS}`);
    return j;
  };
  const member = (m: CohortView["members"][number], matchScore: number | null): ProposalMember => ({
    memberId: m.memberId,
    label: m.label,
    source: sourceOf(m.memberId),
    membership: m.membership,
    roleFamily: null,
    seniority: null,
    matchScore,
    reusable: m.runState === "reused",
  });
  const applicants = done.members.filter((m) => m.membership === "applicant");
  const matched = done.members.filter((m) => m.membership === "matched");
  const added = done.members.filter((m) => m.membership === "added");
  const proposed = [
    ...applicants.map((m) => member(m, null)),
    ...matched.slice(0, PROPOSED_MATCHED).map((m, i) => member(m, MATCH_TOP - i * MATCH_STEP)),
  ];
  const population: PopulationLite[] = [...matched.slice(PROPOSED_MATCHED), ...added].map((m) => ({
    key: m.memberId,
    source: m.memberId.startsWith(PROFILE) ? "profile" : "analysis",
    // The member id doubles as the row's analysis slug, so a hand-added member is the SAME id
    // the finished fixture holds (live, the server resolves a slug to its CV the same way).
    slug: m.memberId,
    id: m.memberId.startsWith(PROFILE) ? m.memberId.slice(PROFILE.length) : null,
    name: m.label,
    seniority: null,
    analyses: [{ slug: m.memberId }],
  }));

  const own = job(COHORT_JOB);
  const roles: CohortRole[] = [
    {
      slug: done.jdSlug,
      title: done.jdTitle,
      created_at: new Date(CREATED).toISOString(),
      roleFamily: own.role_family,
      seniority: own.seniority,
      company: done.orgName,
      analysisCount: done.members.filter((m) => m.runState === "reused").length,
      pipeline: { total: applicants.length },
    },
    ...OTHER_ROLES.map(({ id, pipeline }, i): CohortRole => {
      const j = job(id);
      return {
        slug: slugOf(j.title),
        title: j.title,
        created_at: new Date(CREATED - (i + 1) * DAY).toISOString(),
        roleFamily: j.role_family,
        seniority: j.seniority,
        company: j.company,
        analysisCount: 0,
        pipeline: pipeline === null ? null : { total: pipeline },
      };
    }),
  ];
  const proposals: Record<string, CohortProposal> = { [done.jdSlug]: proposal(done.jdSlug, done.jdTitle, done.orgName, proposed) };
  for (const r of roles.slice(1)) proposals[r.slug] = proposal(r.slug, r.title, done.orgName, []);
  return { source: [DONE, JOBS], roles, proposals, population };
}

export const serializeWalkthrough = (fx: WalkthroughFixture): string => `${JSON.stringify(fx, null, 2)}\n`;

export function readInputs(): { done: CohortView; jobs: SeedJob[] } {
  return {
    done: JSON.parse(fs.readFileSync(new URL(DONE, ROOT), "utf8")) as CohortView,
    jobs: JSON.parse(fs.readFileSync(new URL(JOBS, ROOT), "utf8")) as SeedJob[],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { done, jobs } = readInputs();
  const out = new URL(WALKTHROUGH_PATH, ROOT);
  fs.writeFileSync(out, serializeWalkthrough(buildWalkthroughFixture(done, jobs)));
  console.log(`wrote ${fileURLToPath(out)}`);
}
