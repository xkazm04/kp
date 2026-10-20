// The cohort view's member LABEL (analyze-cohort-view.ts projectAnalysisCohortMembers) over a
// fake engine and fake stores: the CV's own candidate.name wins over a stored
// "Name → Role" label, a missing name falls back to the label without its suffix, a
// withheld member is masked, and a blind cohort shows only its neutral letter.
// unit-db.ts first: the module under test imports the real stores for its wiring.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { assembleAnalysisCohortView, cohortRoleContext, projectAnalysisCohortMembers, type ViewDeps } from "./analyze-cohort-view.ts";
import type { JobRecord } from "./db/core.ts";
import type { RoleContext } from "../features/tools/analyze/cohort/cohortTypes.ts";
import type { AnalysisCohortRecord } from "./db/analysis-cohorts.ts";
import type { ProjectInput } from "../features/tools/analyze/cohort/cohortProject.ts";

after(() => cleanupUnitDb());

function rec(blind = false): AnalysisCohortRecord {
  const member = (id: string, label: string) => ({
    memberId: id,
    label,
    membership: "matched" as const,
    source: { kind: "analysis" as const, slug: id },
    runState: "done" as const,
    analysisSlug: `an-${id}`,
    error: null,
    rowLabel: label,
    shownNames: [],
  });
  return {
    id: "coh-1",
    workspaceId: "workspace",
    jdSlug: "role",
    status: "done",
    blind,
    reportLang: "en",
    orderSeed: "coh-1",
    members: [
      member("a", "Martin Novotný → Senior Java Backend Engineer"),
      member("b", "Vít Malý → Senior Java Backend Engineer"),
      member("c", "Zdenka Procházková → Senior Java Backend Engineer"),
    ],
    comments: null,
    taskId: null,
    createdAt: "2026-10-09T00:00:00Z",
    finishedAt: "2026-10-09T00:01:00Z",
  };
}

function deps(seen: ProjectInput[]): ViewDeps {
  const names: Record<string, string | null> = { "an-a": "Martin Novotný", "an-b": null, "an-c": "Zdenka Procházková" };
  return {
    engine: {
      projectCohortMember: (input) => {
        seen.push(input);
        return input as never;
      },
      assembleCohortView: () => {
        throw new Error("not used");
      },
      neutralOrder: (_id, ids) => [...ids].reverse(),
    },
    loadAnalysis: (slug) => ({
      row: { slug, candidate_label: "stored", jd_slug: "role", score: 70, role_family: null, seniority: null, payload_json: "{}", created_at: "" },
      payload: { candidate: { name: names[slug] ?? null, rawText: "cv" } },
    }),
    parseStoredGithub: () => null,
    withholdsPii: (label) => label.startsWith("Zdenka"),
    scrubPii: (p) => ({ ...(p as object), candidate: { name: "", rawText: "" } }),
    maskName: (label) => `${label.split(" ")[0]} ${label.split(" ")[1]?.[0] ?? ""}.`,
    taskStatus: () => null,
  };
}

test("the CV's own name wins, then the label without its role suffix, and a withheld member is masked", () => {
  const seen: ProjectInput[] = [];
  projectAnalysisCohortMembers(rec(), null, deps(seen));
  assert.deepEqual(
    seen.map((s) => s.label),
    ["Martin Novotný", "Vít Malý", "Zdenka P."]
  );
  assert.ok(seen.every((s) => !s.label.includes("→")));
});

test("a blind cohort shows only the neutral letter", () => {
  const seen: ProjectInput[] = [];
  projectAnalysisCohortMembers(rec(true), null, deps(seen));
  // neutralOrder reversed: c, b, a -> a is position 2.
  assert.deepEqual(
    seen.map((s) => s.label),
    ["Candidate C", "Candidate B", "Candidate A"]
  );
});

// ---- the role the why-engine reads ---------------------------------------------------------

const JOB: JobRecord = {
  id: "jd-role",
  title: "Senior Java Backend Engineer",
  seniority: "senior",
  roleFamily: "software_engineering",
  minYearsExperience: 6,
  salaryBand: [110000, 160000],
  defaultedFields: [],
};

test("cohortRoleContext reads the job row: min years, seniority, family and the band; a defaulted value is no value", () => {
  assert.deepEqual(cohortRoleContext(JOB), {
    minYears: 6,
    seniority: "senior",
    band: { currency: "CZK", period: "month", min: 110000, max: 160000 },
    roleFamily: "software_engineering",
  });
  const phantom = cohortRoleContext({ ...JOB, seniority: "medior", minYearsExperience: 0, defaultedFields: ["seniority", "salary_band"] });
  assert.deepEqual(phantom, { minYears: null, seniority: null, band: null, roleFamily: "software_engineering" });
  assert.equal(cohortRoleContext(null), null);
});

test("the stored cohort's view hands the engine the job row's RoleContext, for every member and for the assembly", () => {
  const seen: ProjectInput[] = [];
  let assembled: RoleContext | null | undefined;
  const d = deps(seen);
  d.engine.assembleCohortView = (base, members, _comments, role) => {
    assembled = role;
    return { ...base, members: [], claims: {} as never, narrative: null, progress: { total: 0, done: 0, reused: 0, failed: 0 }, criteria: {} as never, roleBand: role?.band ?? null };
  };
  const view = assembleAnalysisCohortView(rec(), { jdTitle: JOB.title, companyText: null, orgName: null, job: JOB }, d);
  const expected = cohortRoleContext(JOB);
  assert.ok(seen.length === 3 && seen.every((s) => JSON.stringify(s.role) === JSON.stringify(expected)));
  assert.deepEqual(assembled, expected);
  assert.deepEqual(view.roleBand, expected?.band);
});
